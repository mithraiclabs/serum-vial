import path from "path";
import { Worker } from 'worker_threads'
import { SerumMarket } from "./types";
import { logger } from ".";
import { wait } from "./helpers";
import { ActivePsyOptionMarketResponse, subscribeToActivePsyOptionMarkets } from "./graphql_client";

interface ProducerArgs {
  wsEndpointPort: number|undefined;
  validateL3Diffs: boolean;
  commitment: string;
  nodeEndpoint: string;
}

interface AddProducerArgs extends ProducerArgs{
  market: SerumMarket;
}

interface StartProducersArgs extends ProducerArgs {
  markets: SerumMarket[];
}
interface SubscribeProducersArgs extends ProducerArgs {
  graphQlUrl: string;
}

const activeMarketProducers: Record<string, boolean> = {};


export const startProducers = async ({wsEndpointPort, validateL3Diffs, nodeEndpoint, commitment, markets}: StartProducersArgs) => {
  for (const market of markets) {

    addProducer({wsEndpointPort, validateL3Diffs, nodeEndpoint, commitment, market})

    // just in case to not get hit by serum RPC node rate limits...
    await wait(1000)
  }
  return true;
};

// TODO define the types returned from the GraphQL API request
export const subscribeToDatabaseMarkets = async ({wsEndpointPort, validateL3Diffs, nodeEndpoint, commitment, graphQlUrl}: SubscribeProducersArgs) => {
  const starterPromise = Promise.resolve(null);
  subscribeToActivePsyOptionMarkets({graphQlUrl, onEvent: async (eventData: ActivePsyOptionMarketResponse) => {
    eventData.data.markets.reduce( async (accumulator, currentMarket): Promise<null> => {
      await accumulator
      // avoid RPC node rate limits
      await(1000)
      const market = {
        address: currentMarket.serum_market.address,
        name: currentMarket.serum_market.address,
        programId: currentMarket.serum_market.program_id,
        deprecated: false
      }
      return addProducer({wsEndpointPort, validateL3Diffs, nodeEndpoint, commitment, market})
    }, starterPromise)
  }})
}

export const addProducer = ({wsEndpointPort, validateL3Diffs, nodeEndpoint, commitment, market}: AddProducerArgs) => {
  // if there is already an active producer for a market, short circuit
  if (activeMarketProducers[market.address]) {
    return null;
  }
  const serumProducerWorker = new Worker(path.resolve(__dirname, 'serum_producer.js'), {
    workerData: { marketName: market.name, nodeEndpoint, validateL3Diffs, market, commitment, wsEndpointPort }
  })

  activeMarketProducers[market.address] = true;

  serumProducerWorker.on('error', (err) => {
    logger.log(
      'error',
      `Serum producer worker ${serumProducerWorker.threadId} error occurred: ${err.message} ${err.stack}`
    )
    throw err
  })

  serumProducerWorker.on('exit', (code) => {
    logger.log('error', `Serum producer worker: ${serumProducerWorker.threadId} died with code: ${code}`)
    delete activeMarketProducers[market.address]
  })
  return null;
}
