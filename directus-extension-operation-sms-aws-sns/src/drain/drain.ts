// src/drain/drain.ts
import { ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";

export type DrainLogger = {
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
};

export type DrainDeps = {
  sqs: { send(cmd: any): Promise<any> };
  queueUrl: string;
  /** Reprocess a single SNS body (parsed JSON or raw string) through the upsert adapter. Throws on failure. */
  processOne: (snsBody: unknown) => Promise<void>;
  maxMessages?: number;     // SQS caps at 10 per receive
  waitTimeSeconds?: number; // long-poll window
  logger?: DrainLogger;
};

export type DrainResult = { received: number; processed: number; deleted: number; failed: number };

export async function drainDlq(deps: DrainDeps): Promise<DrainResult> {
  const max = Math.min(deps.maxMessages ?? 10, 10);
  const wait = deps.waitTimeSeconds ?? 20;
  const result: DrainResult = { received: 0, processed: 0, deleted: 0, failed: 0 };

  // Drain the backlog: keep polling until a receive comes back empty.
  for (;;) {
    const recv = await deps.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: deps.queueUrl,
        MaxNumberOfMessages: max,
        WaitTimeSeconds: wait,
      }),
    );
    const messages: any[] = recv?.Messages ?? [];
    if (messages.length === 0) break;

    for (const m of messages) {
      result.received++;
      let body: unknown = m.Body;
      try {
        if (typeof m.Body === "string") body = JSON.parse(m.Body);
      } catch {
        body = m.Body; // let processOne decide; it parses/validates the envelope
      }
      try {
        await deps.processOne(body);
        result.processed++;
        await deps.sqs.send(
          new DeleteMessageCommand({ QueueUrl: deps.queueUrl, ReceiptHandle: m.ReceiptHandle }),
        );
        result.deleted++;
      } catch (err) {
        result.failed++;
        deps.logger?.warn(
          `DLQ drain: leaving message on queue after failure: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Not deleted → becomes visible again after the visibility timeout for a later drain.
      }
    }
  }

  deps.logger?.info(
    `DLQ drain: received=${result.received} processed=${result.processed} deleted=${result.deleted} failed=${result.failed}`,
  );
  return result;
}
