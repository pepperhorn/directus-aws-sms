// src/drain/drain.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { drainDlq } from "./drain.js";

const sqsMock = mockClient(SQSClient);

const snsBody = (inboundMessageId: string) =>
  JSON.stringify({
    Type: "Notification",
    Message: JSON.stringify({
      originationNumber: "+61412345678", destinationNumber: "+61480000000",
      messageBody: "hi", inboundMessageId,
    }),
  });

beforeEach(() => sqsMock.reset());

describe("drainDlq", () => {
  it("processes each received message and deletes it on success", async () => {
    sqsMock
      .on(ReceiveMessageCommand)
      .resolvesOnce({ Messages: [
        { Body: snsBody("a"), ReceiptHandle: "rh-a" },
        { Body: snsBody("b"), ReceiptHandle: "rh-b" },
      ] })
      .resolves({ Messages: [] }); // second poll: empty → stop
    sqsMock.on(DeleteMessageCommand).resolves({});

    const processOne = vi.fn().mockResolvedValue(undefined);
    const out = await drainDlq({ sqs: new SQSClient({}), queueUrl: "q", processOne });

    expect(out).toEqual({ received: 2, processed: 2, deleted: 2, failed: 0 });
    expect(processOne).toHaveBeenCalledTimes(2);
    expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(2);
  });

  it("leaves a message on the queue (no delete) when processing throws", async () => {
    sqsMock
      .on(ReceiveMessageCommand)
      .resolvesOnce({ Messages: [{ Body: snsBody("bad"), ReceiptHandle: "rh-bad" }] })
      .resolves({ Messages: [] });
    sqsMock.on(DeleteMessageCommand).resolves({});

    const processOne = vi.fn().mockRejectedValue(new Error("db down"));
    const out = await drainDlq({ sqs: new SQSClient({}), queueUrl: "q", processOne });

    expect(out).toEqual({ received: 1, processed: 0, deleted: 0, failed: 1 });
    expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
  });

  it("returns zeros when the queue is empty", async () => {
    sqsMock.on(ReceiveMessageCommand).resolves({ Messages: [] });
    const out = await drainDlq({ sqs: new SQSClient({}), queueUrl: "q", processOne: vi.fn() });
    expect(out).toEqual({ received: 0, processed: 0, deleted: 0, failed: 0 });
  });

  it("deletes only the successes in a mixed batch", async () => {
    sqsMock
      .on(ReceiveMessageCommand)
      .resolvesOnce({ Messages: [
        { Body: snsBody("ok"), ReceiptHandle: "rh-ok" },
        { Body: snsBody("fail"), ReceiptHandle: "rh-fail" },
      ] })
      .resolves({ Messages: [] });
    sqsMock.on(DeleteMessageCommand).resolves({});

    const processOne = vi.fn()
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => { throw new Error("boom"); });
    const out = await drainDlq({ sqs: new SQSClient({}), queueUrl: "q", processOne });

    expect(out).toMatchObject({ received: 2, processed: 1, deleted: 1, failed: 1 });
    const deletes = sqsMock.commandCalls(DeleteMessageCommand);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].args[0].input.ReceiptHandle).toBe("rh-ok");
  });
});
