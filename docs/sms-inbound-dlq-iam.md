# SMS inbound — IAM policy for DLQ provisioning + diagnostics

Region `us-east-1`, account `538784191676`, topic `crf-sms-twoway`,
proposed DLQ queue name `crf-sms-inbound-dlq`.

## 1. Add to `crf-cliuser` (the ops/diagnostics key)

Lets me create the DLQ, attach the redrive policy to the live subscription, and
inspect anything that gets dropped.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SnsSubscriptionAdmin",
      "Effect": "Allow",
      "Action": [
        "sns:GetSubscriptionAttributes",
        "sns:SetSubscriptionAttributes",
        "sns:GetTopicAttributes",
        "sns:ListSubscriptionsByTopic"
      ],
      "Resource": "arn:aws:sns:us-east-1:538784191676:crf-sms-twoway"
    },
    {
      "Sid": "SqsListForInventory",
      "Effect": "Allow",
      "Action": "sqs:ListQueues",
      "Resource": "*"
    },
    {
      "Sid": "SqsDlqProvisionAndInspect",
      "Effect": "Allow",
      "Action": [
        "sqs:CreateQueue",
        "sqs:GetQueueUrl",
        "sqs:GetQueueAttributes",
        "sqs:SetQueueAttributes",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage"
      ],
      "Resource": "arn:aws:sqs:us-east-1:538784191676:crf-sms-inbound-dlq"
    }
  ]
}
```

`sns:Subscribe` is already granted via the topic's resource policy, so it is not
needed here.

## 2. Add to `crf-coolify` (the Directus runtime / prod sender key)

The scheduled **Drain SMS Inbound DLQ** operation runs inside Directus as this
identity and must be able to pull from the DLQ.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SmsInboundDlqDrain",
      "Effect": "Allow",
      "Action": [
        "sqs:GetQueueUrl",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage"
      ],
      "Resource": "arn:aws:sqs:us-east-1:538784191676:crf-sms-inbound-dlq"
    }
  ]
}
```

## Notes

- The DLQ's **queue policy** (set at creation) must allow `sns.amazonaws.com` to
  `sqs:SendMessage` to it, conditioned on `aws:SourceArn` =
  `arn:aws:sns:us-east-1:538784191676:crf-sms-twoway`. I set that when I create
  the queue — it is separate from the IAM user policies above.
- After the queue exists, the subscription gets a `RedrivePolicy` pointing at the
  queue ARN (via `sns:SetSubscriptionAttributes` on the live subscription — no
  recreate needed).
- Directus also needs `SMS_AWS_DLQ_URL` set to the queue URL so the drain
  operation knows where to poll.
