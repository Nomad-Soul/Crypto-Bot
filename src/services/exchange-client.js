import { redBright, yellowBright, cyanBright, greenBright } from 'ansis';
import ClientBase from './client.js';
import ccxt, { Exchange, kraken } from 'ccxt';

import App from '../app.js';
import PairData from '../data/pair-data.js';
import KrakenBot from './kraken.js';
import Action from '../data/action.js';
import ExchangeOrder from '../data/exchange-order.js';
import EcaOrder from '../data/eca-order.js';

export default class ExchangeClient extends ClientBase {
  /** @type {Exchange} */
  #ccxtClient;
  /** @type {import('ccxt').Dictionary} */
  /**
   *
   * @param {import('../types.js').AccountSettings} accountSettings
   */

  #krakenClient;
  constructor(accountSettings) {
    super(accountSettings);
    this.#ccxtClient = new ccxt[accountSettings.type]({
      apiKey: accountSettings.publicKey,
      secret: accountSettings.privateKey,
    });

    this.#krakenClient = new KrakenBot(accountSettings);
    this.id = 'ccxt';
    this.requestTickers(['btc/eur'.toUpperCase()]).then((response) => console.log(response));
    this.requestBalance().then((r) => console.log(r));
    this.requestOrder('OJVWDS-RYFDV-R2FDGF').then((r) => console.log(r));
    //this.requestOrder('85b2452f-e584-4cd2-b328-a70e6caf7e7b').then((r) => console.log(r));
  }

  async test() {
    await this.#ccxtClient.loadMarkets();

    //var orders = await this.#ccxtClient.fetchClosedOrders(undefined, undefined, 100);
    var orderId = 'a Kraken order id';

    var now = Date.now();
    var order = await this.#ccxtClient.fetchOrder(orderId);
    //var order = orders.find((o) => o.id === orderId);
    console.log(order);
    var elapsed = Date.now() - now;
    App.warning(`Took: ${elapsed} ms`);

    now = Date.now();
    order = await this.#krakenClient.queryOrder(orderId);
    elapsed = Date.now() - now;
    console.log(order.txid);
    App.warning(`Took: ${elapsed} ms`);
  }

  /**
   * @param {{ since: number; pair: string; }} options
   */
  async requestOHLC(options) {
    console.log(options.since);
    return this.#ccxtClient
      .fetchOHLCV(options.pair.toUpperCase(), '1d', options.since)
      .then((response) => response.map((candle) => ({ x: candle[0], o: candle[1], h: candle[2], l: candle[3], c: candle[4], vol: candle[5] })));
  }

  /**
   *
   * @param {Action} action
   * @returns
   */
  async submitOrder(action) {
    var order = action.order;
    App.log(`${greenBright`[${order.id}]: submitting`} ${yellowBright`${order.type} order ${order.direction} at ${order.price} on ${action.account}`}`);
    return this.#ccxtClient.createOrder(order.pair.toUpperCase(), order.type, order.direction, order.volume, order.price);
  }

  async cancelOrder(action) {
    var order = action.order;
    App.log(`${greenBright`[${order.id}]: cancelling`} ${yellowBright`${order.txid}`} on ${action.account}`);
    return this.#ccxtClient.cancelOrder(order.txid);
  }

  async editOrder(action) {
    var order = action.order;
    App.log(`${greenBright`[${order.id}]: editing`} ${yellowBright`${order.txid}`} on ${action.account}`);
    App.log(`Edited price: ${order.price} volume: ${order.volume}`);
    return this.#ccxtClient.editOrder(order.txid, order.pair, order.type, order.direction, order.vol, order.price);
  }

  async requestPairList(saveToFile = true) {
    App.log(greenBright`Requesting pair list for ${this.id}`);
    await this.#ccxtClient.loadMarkets();

    return this.#ccxtClient
      .loadMarkets()
      .then((response) =>
        [...Object.entries(response)]
          .map(([key, pair]) => ExchangeClient.ConvertPairData(pair, this.#ccxtClient.precisionMode))
          .filter((pair) => pair.quote.toLowerCase() === App.locale.currency),
      )
      .then((data) => {
        if (!saveToFile) return;
        var dataEntries = { _exchange: this.type, _createdOn: new Date(Date.now()).toISOString() };
        data.forEach((pairData) => (dataEntries[pairData.id] = pairData));
        App.warning(`D: ${data.length} C:${App.locale.currency}`);
        App.writeFile(`${App.DataPath}/exchanges/${this.type}-pairs`, dataEntries);
      });
  }

  /**
   *
   * @param {string} txid
   */
  async requestOrder(txid) {
    return this.#ccxtClient.fetchOrder(txid);
  }

  /**
   *
   * @param {string[]} pairs
   * @returns {Promise<>}
   */
  async requestTickers(pairs) {
    App.log(greenBright`Updating prices from ${this.id}`);
    return this.#ccxtClient.fetchTickers(pairs).then((data) => Object.entries(data).map(([key, ticker]) => ({ key: ticker.close })));
  }

  /**
   *
   * @returns {Promise<[string, number][]>}
   */
  async requestBalance() {
    App.log(greenBright`Requesting balance from ${this.id}`);
    return this.#ccxtClient
      .fetchBalance()
      .then((balances) => Object.entries(balances.total).forEach((balance) => this.balances.set(balance[0].toLowerCase(), balance[1])))
      .then(() => [...this.balances.entries()]);
  }

  /**
   *
   * @param {string[]} txidArray
   * @returns {Promise<>}
   */
  async downloadOrdersByTxid(txidArray) {
    App.log(greenBright`Downloading ${this.id} orders ${yellowBright`${txidArray.join(', ')}`}`, true);
    //this.#ccxtClient.fetchOrders(pair);

    if (this.#ccxtClient.id === 'kraken') {
      /** @type {kraken} */
      // @ts-ignore
      var krakenClient = this.#ccxtClient;
      return krakenClient.fetchOrdersByIds(txidArray).then((orders) =>
        orders.forEach((order) => {
          this.setExchangeOrder(order.id, order);
          return true;
        }),
      );
    } else {
      Promise.all(txidArray.map((txid) => this.requestOrder(txid))).then((orders) =>
        orders.forEach((order) => this.setExchangeOrder(order.id, ExchangeClient.ConvertCcxtOrderToExchangeOrder(order))),
      );
    }
  }

  /**
   * @param {any} marketData
   * @returns {PairData}
   * @param {number} precisionMode
   */
  static ConvertPairData(marketData, precisionMode) {
    return new PairData({
      id: `${marketData.base}/${marketData.quote}`.toLocaleLowerCase(),
      base: marketData.base.toLowerCase(),
      quote: marketData.quote.toLowerCase(),
      nativeBaseId: marketData.baseId,
      nativeQuoteId: marketData.quoteId,
      minVolume: marketData.limits.amount.min,
      maxBaseDigits: ExchangeClient.ConvertPrecision(precisionMode, marketData.precision.amount),
      maxQuoteDigits: ExchangeClient.ConvertPrecision(precisionMode, marketData.precision.price),
      minBaseDisplayDigits: ExchangeClient.ConvertPrecision(precisionMode, marketData.limits.amount.min),
    });
  }

  /**
   *
   * @param {import('ccxt').Order} order
   * @returns {ExchangeOrder}
   */
  static ConvertCcxtOrderToExchangeOrder(order, exchangeType) {
    var closeTime = undefined;
    // ccxt currently lacks a property for the close time (or is undefined)
    // hopefully this is a temporary workaround
    if (order.status === 'closed') {
      switch (exchangeType) {
        case 'kraken':
          closeTime = new Date(order.info.closetm * 1000);
          break;

        case 'binance':
          closeTime = new Date(order.info.last_fill_time);
          break;
      }
    } else if (order.status === 'canceled') {
      if (order.filled > 0) {
        order.status = 'closed';
      } else order.status = 'cancelled';
    }

    return new ExchangeOrder({
      type: order.type,
      status: KrakenBot.ConvertKrakenStatusToExchangeOrder(order.status, order),
      side: order.side,
      openDate: new Date(order.timestamp),
      closeDate: closeTime,
      volume: order.filled,
      price: order.price,
      cost: order.cost,
      fees: order.fee.cost,
      userref: order.clientOrderId,
      pair: order.symbol.toLowerCase(),
    });
  }

  /**
   *
   * @param {import('ccxt').Order} order
   */
  static ConvertToExchangeOrder(order) {}

  /**
   * @param {any} precisionMode
   * @param {Number} value
   */
  static ConvertPrecision(precisionMode, value) {
    switch (precisionMode) {
      case ccxt.TICK_SIZE: {
        let valueString = value.toString();
        if (valueString.startsWith('1e-')) return Number(valueString.split('-')[1]);
        else return valueString.split('.')[1]?.length || 0;
      }

      default:
        return value;
    }
  }
}
