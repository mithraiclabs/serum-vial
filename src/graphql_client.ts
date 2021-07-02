import { DocumentNode, execute } from 'apollo-link';
import { WebSocketLink } from 'apollo-link-ws';
import { SubscriptionClient } from 'subscriptions-transport-ws';
import { gql } from 'graphql-tag';
import fetch from "node-fetch"
import { wait } from './helpers';

const ws = require('ws');

const getWsClient = function(wsurl: string) {
  const client = new SubscriptionClient(
    wsurl, {reconnect: true}, ws
  );
  return client;
};

const createSubscriptionObservable = (wsurl: string, query: DocumentNode, variables: object) => {
  const link = new WebSocketLink(getWsClient(wsurl));
  return execute(link, {query: query, variables: variables});
};

export const waitUntilServerUp = async (graphQlUrl: string) => {
  while(true) {
    try {
      const response = await fetch(graphQlUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({query: {}}),
      });
      if (response.status === 200) {
        break
      }
    } catch (error) {
      console.error(error)
    }
    console.log('...GraphQL server not ready, waiting')
    await wait(1000)
  }
  return true
}

type SubscriptionArguments = {
  graphQlUrl: string,
  onEvent: (eventData: any) => void,
  onError?: (error: Error) => void,
}

// TODO refactor this and the DB to be generic Serum markets so other projects can use it
export type ActivePsyOptionMarketResponse = {
  data: {
    markets: [{
      serum_market: {
        address:  string;
        program_id: string;
      }
    }]
  }
}

export const subscribeToActivePsyOptionMarkets = ({graphQlUrl, onEvent, onError}: SubscriptionArguments) => {
  // To be considered active the PsyOptions market must have a Serum address and not be expired
  const SUBSCRIBE_QUERY = gql`
  subscription ActivePsyOptionMarkets {
    markets(where: {serum_address: {_is_null: false}, expires_at: {_gte: "now()"}}) {
      serum_market {
        address
        program_id
      }
    }
  }
  `
  const subscriptionClient = createSubscriptionObservable(
    graphQlUrl,
    SUBSCRIBE_QUERY,                                     // Subscription query
    {}                                                   // Query variables
  );
  return subscriptionClient.subscribe(onEvent, (error) => {
    console.error(error)
    if (onError) {
      onError(error)
    }
  })
}
