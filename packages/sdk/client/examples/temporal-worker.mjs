/** Temporal 1.23.0 worker that registers the DSH Activity adapter. */

import { fileURLToPath } from 'node:url'
import { NativeConnection, Worker } from '@temporalio/worker'
import { createDshTemporalActivities } from './temporal-activity.mjs'

const taskQueue = process.env.DSH_TEMPORAL_TASK_QUEUE
if (taskQueue === undefined || taskQueue.trim() === '') {
  throw new Error('DSH_TEMPORAL_TASK_QUEUE is required')
}

const connection = await NativeConnection.connect({
  address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
})

try {
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue,
    workflowsPath: fileURLToPath(new URL('./temporal-workflow.mjs', import.meta.url)),
    activities: createDshTemporalActivities(),
  })
  await worker.run()
} finally {
  await connection.close()
}
