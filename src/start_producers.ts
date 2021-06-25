import path from "path";
import { Worker } from 'worker_threads'
import { SerumMarket } from "./types";
import { logger } from ".";
import { wait } from "./helpers";

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

export const startProducers = async ({wsEndpointPort, validateL3Diffs, nodeEndpoint, commitment, markets}: StartProducersArgs) => {
  for (const market of markets) {

    addProducer({wsEndpointPort, validateL3Diffs, nodeEndpoint, commitment, market})

    // just in case to not get hit by serum RPC node rate limits...
    await wait(1000)
  }
  return true;
};

export const addProducer = ({wsEndpointPort, validateL3Diffs, nodeEndpoint, commitment, market}: AddProducerArgs) => {
  const serumProducerWorker = new Worker(path.resolve(__dirname, 'serum_producer.js'), {
    workerData: { marketName: market.name, nodeEndpoint, validateL3Diffs, market, commitment, wsEndpointPort }
  })

  serumProducerWorker.on('error', (err) => {
    logger.log(
      'error',
      `Serum producer worker ${serumProducerWorker.threadId} error occurred: ${err.message} ${err.stack}`
    )
    throw err
  })

  serumProducerWorker.on('exit', (code) => {
    logger.log('error', `Serum producer worker: ${serumProducerWorker.threadId} died with code: ${code}`)
  })
}
