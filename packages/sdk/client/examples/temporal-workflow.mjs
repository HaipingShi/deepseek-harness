/** Temporal 1.23.0 workflow that delegates all DSH effects to one Activity. */

import { proxyActivities } from '@temporalio/workflow'

const { runDshTask } = proxyActivities({
  startToCloseTimeout: '30 minutes',
  heartbeatTimeout: '30 seconds',
  retry: { maximumAttempts: 1 },
})

/** Run one non-retried DSH task and retain its receipt in Workflow history. */
export async function dshTaskWorkflow(input) {
  return await runDshTask(input)
}
