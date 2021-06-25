import os from 'os'
import path from 'path'
import { Worker } from 'worker_threads'
import { cleanupChannel, minionReadyChannel, serumProducerReadyChannel, wait } from './helpers'
import { logger } from './logger'
import { SerumMarket } from './types'
import { startProducers } from './start_producers'

export async function bootServer({
  port,
  nodeEndpoint,
  wsEndpointPort,
  validateL3Diffs,
  minionsCount,
  markets,
  commitment
}: BootOptions) {
  // multi core support is linux only feature which allows multiple threads to bind to the same port
  // see https://github.com/uNetworking/uWebSockets.js/issues/304 and https://lwn.net/Articles/542629/
  const MINIONS_COUNT = os.platform() === 'linux' ? minionsCount : 1
  let readyMinionsCount = 0

  logger.log(
    'info',
    MINIONS_COUNT === 1 ? 'Starting single minion worker...' : `Starting ${MINIONS_COUNT} minion workers...`
  )
  minionReadyChannel.onmessage = () => readyMinionsCount++

  // start minions workers and wait until all are ready

  for (let i = 0; i < MINIONS_COUNT; i++) {
    const minionWorker = new Worker(path.resolve(__dirname, 'minion.js'), {
      workerData: { nodeEndpoint, port, markets }
    })

    minionWorker.on('error', (err) => {
      logger.log('error', `Minion worker ${minionWorker.threadId} error occurred: ${err.message} ${err.stack}`)
      throw err
    })
    minionWorker.on('exit', (code) => {
      logger.log('error', `Minion worker: ${minionWorker.threadId} died with code: ${code}`)
    })
  }

  startProducers({wsEndpointPort, markets, validateL3Diffs, commitment, nodeEndpoint})

  await new Promise<void>(async (resolve) => {
    while (true) {
      if (readyMinionsCount === MINIONS_COUNT) {
        break
      }
      await wait(100)
    }

    resolve()
  })

  logger.log('info', `Starting serum producers for ${markets.length} markets, rpc endpoint: ${nodeEndpoint}`)

  let readyProducersCount = 0

  serumProducerReadyChannel.onmessage = () => readyProducersCount++

  await new Promise<void>(async (resolve) => {
    while (true) {
      if (readyProducersCount === markets.length) {
        break
      }
      await wait(100)
    }

    resolve()
  })
}

export async function stopServer() {
  cleanupChannel.postMessage('cleanup')

  await wait(10 * 1000)
}

type BootOptions = {
  port: number
  nodeEndpoint: string
  wsEndpointPort: number | undefined
  validateL3Diffs: boolean
  minionsCount: number
  commitment: string
  markets: SerumMarket[]
}
