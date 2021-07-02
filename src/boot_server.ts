import os from 'os'
import path from 'path'
import { Worker } from 'worker_threads'
import { cleanupChannel, minionReadyChannel, serumProducerReadyChannel, wait } from './helpers'
import { logger } from './logger'
import { SerumMarket } from './types'
import { addProducer, startProducers, subscribeToDatabaseMarkets } from './start_producers'
import { ActivePsyOptionMarketResponse, subscribeToActivePsyOptionMarkets, waitUntilServerUp } from './graphql_client'

export async function bootServer({
  port,
  nodeEndpoint,
  wsEndpointPort,
  validateL3Diffs,
  minionsCount,
  markets,
  commitment,
  graphQlUrl,
}: BootOptions) {
  // multi core support is linux only feature which allows multiple threads to bind to the same port
  // see https://github.com/uNetworking/uWebSockets.js/issues/304 and https://lwn.net/Articles/542629/
  const MINIONS_COUNT = os.platform() === 'linux' ? minionsCount : 1
  let readyMinionsCount = 0

  logger.log('info', `graphQlUrl: ${graphQlUrl}`)

  logger.log(
    'info',
    MINIONS_COUNT === 1 ? 'Starting single minion worker...' : `Starting ${MINIONS_COUNT} minion workers...`
  )
  minionReadyChannel.onmessage = () => readyMinionsCount++

  // start minions workers and wait until all are ready
  const startMinions = (minionMarkets: SerumMarket[]) => {
    for (let i = 0; i < MINIONS_COUNT; i++) {
      const minionWorker = new Worker(path.resolve(__dirname, 'minion.js'), {
        workerData: { nodeEndpoint, port, markets: minionMarkets }
      })
  
      minionWorker.on('error', (err) => {
        logger.log('error', `Minion worker ${minionWorker.threadId} error occurred: ${err.message} ${err.stack}`)
        throw err
      })
      minionWorker.on('exit', (code) => {
        logger.log('error', `Minion worker: ${minionWorker.threadId} died with code: ${code}`)
      })
    }
  }

  // if provided with a GraphQL URL use the subscription method to subscribe
  if (graphQlUrl) {
    // wait until graphQL server is up and running
    await waitUntilServerUp(graphQlUrl);

    const starterPromise = Promise.resolve(null);
    subscribeToActivePsyOptionMarkets({graphQlUrl, onEvent: async (eventData: ActivePsyOptionMarketResponse) => {
      logger.log('info', `eventData returned: ${eventData.data.markets.length}`)
      const updatedMarkets = eventData.data.markets.map(x => ({
        address: x.serum_market.address,
        name: x.serum_market.address,
        programId: x.serum_market.program_id,
        deprecated: false
      }))
      // When the markets array changes we need to restart the minions
      stopServer();
      startMinions(updatedMarkets);


      // Add a producer for each active market
      updatedMarkets.reduce( async (accumulator, market): Promise<null> => {
        await accumulator
        // avoid RPC node rate limits
        await(1000)
        return addProducer({wsEndpointPort, validateL3Diffs, nodeEndpoint, commitment, market})

      }, starterPromise)
    }})
  } else {
    startMinions(markets);
    startProducers({wsEndpointPort, markets, validateL3Diffs, commitment, nodeEndpoint})
  }

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
  graphQlUrl?: string
}
