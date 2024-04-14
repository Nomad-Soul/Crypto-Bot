import { yellowBright, cyanBright, redBright, greenBright, magentaBright } from 'ansis';

import App from '../app.js';
import CryptoBot from '../crypto-bot.js';
import Utils from '../utils.js';
import ClientBase from '../services/client.js';
import EcaTrader from './eca-trader.js';

export default class TradeHistory {
  /**
   * @typedef {Object} TradeData
   * @property {Number} index
   * @property {string} openDate
   * @property {string} closeDate
   * @property {Number} costBasis
   * @property {Number} proceeds
   * @property {string} currency
   * @property {Boolean} reliable;
   */
  #bot;
  #botId;
  #botSettings;

  /**
   *
   * @param {CryptoBot} bot
   * @param {string} botId
   */
  constructor(bot, botId) {
    if (typeof bot === 'undefined') throw new Error('Invalid argument: bot');
    this.#bot = bot;
    this.#botId = botId;
    this.#botSettings = this.#bot.getBotSettings(botId);
  }

  /**
   *
   * @param {ClientBase} accountClient
   */
  reportPurchases(accountClient) {
    console.log(this.#bot.listMissingLocalOrders());
    var orders = this.#bot
      .getPlannedOrders(this.#botId)
      .filter((o) => o.status === 'executed')
      .map((o) => accountClient.getLocalOrder(o.txid))
      .map((o) => [o.closeDate.getTime(), o.price, o.volume]);

    return orders;
  }

  /**
   *
   * @param {ClientBase} accountClient
   * @param {{verbose: boolean, saveFile: boolean}} options
   */
  async analyseOrders(accountClient, options = undefined) {
    const { verbose, saveFile } = options || { verbose: false, saveFile: false };

    var balance = 0;
    await accountClient.downloadAllOrders('closed');

    var dataDeals = [];
    var dealIndex = 1;

    var orders = [...accountClient.orders.keys()]
      .map((txid) => accountClient.getLocalOrder(txid))
      .filter((o) => o.isClosed)
      .sort((a, b) => a.closeDate.getTime() - b.closeDate.getTime());
    var prevOrder = null;
    var costBasis = 0;
    var proceeds = 0;
    var openDate = orders[0].openDate;
    var closeDate;

    function savePnl(lastOrder) {
      if (verbose) App.log(yellowBright`Profit: ${(proceeds - costBasis).toFixed(2)} (${proceeds.toFixed(2)}:${costBasis.toFixed(2)})`);
      closeDate = prevOrder.closeDate;
      dataDeals.push({
        index: dealIndex++,
        openDate: openDate,
        closeDate: closeDate,
        costBasis: Number(costBasis.toFixed(2)),
        proceeds: Number(proceeds.toFixed(2)),
        currency: 'eur',
        reliable: balance >= 0 && balance * lastOrder.price < 0.5,
      });
      balance = 0;
      costBasis = 0;
      proceeds = 0;
    }

    for (let i = 0; i < orders.length; i++) {
      let order = orders[i];
      let color = order.side === 'buy' ? cyanBright : greenBright;

      if (prevOrder != null && order.side === 'buy' && prevOrder.side === 'sell') {
        savePnl(order);

        openDate = order.openDate;
      }

      if (order.side === 'buy') {
        balance += order.volume;
        costBasis += order.volume * order.price + order.fees;
      } else {
        balance -= order.volume;
        proceeds += order.volume * order.price - order.fees;
      }

      if (order.side === 'sell' && (balance > 2e-8 || balance < 0)) color = redBright;

      let localOrder = this.#bot.getPlannedOrderByTxid(order.txid);
      if (verbose)
        App.log(
          color`[${order.userref}]: ${Utils.toShortDate(order.closeDate)} ${order.side} [${order.txid} / ${localOrder?.id || 'unknown'}] Vol: ${order.volume.toFixed(8)} / ${balance.toFixed(8)} (${(order.volume * order.price).toFixed(2)} EUR + ${order.fees.toFixed(2)} EUR)`,
        );
      prevOrder = order;
    }
    savePnl(prevOrder);

    if (saveFile) App.writeFile(`${App.DataPath}/${accountClient.id}/${accountClient.id}-data`, dataDeals);
  }

  calculatePnL(timeInterval = 'week') {
    var dataset = new Map();
    var account = this.#botSettings.account;
    var data = App.readFileSync(`${App.DataPath}/${account}/${account}-data.json`);

    App.warning(`Analysing ${data.length} trades`);
    for (let i = 0; i < data.length; i++) {
      var trade = data[i];
      var closeDate = new Date(trade.closeDate);
      var weekNumber = Utils.getWeekNumber(closeDate);
      var weekYear = Utils.getWeekYear(closeDate);
      var label = `${weekYear}-${weekNumber.toString().padStart(2, '0')}`;
      if (!dataset.has(label)) dataset.set(label, { pnl: 0, reliable: true });
      var currentValue = dataset.get(label).pnl;
      dataset.set(label, { pnl: currentValue + trade.proceeds - trade.costBasis, reliable: trade.reliable });
    }
    // console.log(dataset);

    return this.fillMissingIntervals('week', dataset);
  }

  /**
   *
   * @param {string} timeInterval Not implemented yet
   * @param {Map<string, TradeData>} dataset
   */
  fillMissingIntervals(timeInterval = 'week', dataset) {
    function addMissingEntries(baseIndex, year, count) {
      for (let i = 1; i < count; i++) {
        let newKey = `${year}-${(baseIndex + i).toString().padStart(2, 0)}`;
        items.push([newKey, { pnl: 0, reliable: true }]);
      }
    }

    var prevYear;
    var prevWeek;
    var items = [];
    for (const [key, value] of dataset) {
      var args = key.split('-');
      var year = Number(args[0]);
      var week = Number(args[1]);
      var weekDelta = week - prevWeek ?? 0;

      if (year - prevYear == 1) {
        let weeksUntilEOY = Utils.getWeekNumber(new Date(prevYear, 11, 28)) + 1 - prevWeek;
        addMissingEntries(prevWeek, prevYear, weeksUntilEOY);
        addMissingEntries(0, year, week);
      } else if ((year - prevYear ?? 0) > 1) {
        App.error('Multi-year gaps not handled');
      } else if (weekDelta >= 1) {
        addMissingEntries(prevWeek, weekDelta);
      }

      items.push([key, value]);
      prevWeek = week;
      prevYear = year;
    }

    return items;
  }
}
