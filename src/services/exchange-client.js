import { redBright, yellowBright, cyanBright, greenBright } from 'ansis';
import ClientBase from './client.js';
import ccxt, { Exchange } from 'ccxt';

import App from '../app.js';
import PairData from '../data/pair-data.js';
import KrakenBot from './kraken.js';

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

  async requestPairList(saveToFile = true) {
    App.log(greenBright`Requesting pair list for ${this.id}`);
    await this.#ccxtClient.loadMarkets();

    return this.#ccxtClient
      .loadMarkets()
      .then((response) =>
        [...Object.entries(response)]
          .map(([key, pair]) => ExchangeClient.ConvertKrakenPairData(pair, this.#ccxtClient.precisionMode))
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

  async requestBalance() {
    App.log(greenBright`Requesting balance from ${this.id}`);
    return this.#ccxtClient
      .fetchBalance()
      .then((balances) => Object.entries(balances.total).forEach((balance) => this.balances.set(balance[0].toLowerCase(), balance[1])))
      .then(() => [...this.balances.entries()]);
  }

  /**
   * @param {any} marketData
   * @returns {PairData}
   * @param {number} precisionMode
   */
  static ConvertKrakenPairData(marketData, precisionMode) {
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
