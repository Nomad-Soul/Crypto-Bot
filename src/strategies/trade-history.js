import { yellowBright, cyanBright, redBright, greenBright, magentaBright } from 'ansis';

import App from '../app/app.js';
import CryptoBot from '../crypto-bot.js';
import Utils from '../utils.js';
import ClientBase from '../services/client.js';
import ExchangeOrder from '../data/exchange-order.js';
import TraderDeal from '../data/trader-deal.js';
import { nanoid } from 'nanoid';
import BotSettings from '../data/bot-settings.js';
import Terminal from '../app/terminal.js';

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
  #botSettings;
  /** @type {ClientBase} */
  #client;

  strategyOrders = {};

  /**
   *
   * @param {CryptoBot} bot
   * @param {string} botId
   */
  constructor(bot, botId) {
    if (typeof bot === 'undefined') throw new Error('Invalid argument: bot');
    this.#bot = bot;
    this.#botSettings = this.#bot.getBotSettings(botId);
    this.#client = bot.getClient(this.#botSettings.account);
  }

  reportPurchases() {
    var orders = this.#botSettings.strategy.strategyOrders['closed']
      .map((txid) => this.#client.getLocalOrder(txid))
      .map((order) => [order.closeDate.getTime(), order.price, order.volume]);
    return orders;
  }

  /**
   *
   * @param {{verbose: boolean, redownload: boolean, saveTrades: boolean, saveDeals: boolean}} options
   */
  async analyseOrders(options = undefined) {
    const { verbose, redownload, saveTrades, saveDeals } = options || { verbose: false, redownload: false, saveTrades: false, saveDeals: false };

    var balance = 0;
    if (redownload) await this.#client.downloadAll(2021, 'closed');

    var dataDeals = [];
    var dealIndex = 1;

    var orders = [...this.#client.orders.values()].filter((order) => order.isClosed).sort((a, b) => a.closeDate.getTime() - b.closeDate.getTime());
    var prevOrder = null;
    var costBasis = 0;
    var proceeds = 0;
    var openDate = orders[0].openDate;
    var closeDate;
    await this.#client.awaitPrices();
    var currentPrice = this.#client.getPrice(this.#botSettings.pair);

    Terminal.log(`Analysing Orders. Current Price for ${cyanBright`${this.#botSettings.pair}`} is ${currentPrice.toFixed(2)};`);

    /**
     * @param {ExchangeOrder} lastOrder
     */
    function savePnl(lastOrder) {
      var profit = proceeds - costBasis;
      if (verbose) {
        var colour = profit > 0 ? greenBright : redBright;
        if (Math.abs(balance * currentPrice) > 10) colour = magentaBright;
        else if (profit < 0 && lastOrder.side === 'buy') {
          profit = balance * currentPrice - costBasis;
        }

        Terminal.log(
          colour`Profit: ${profit.toFixed(2)} (${proceeds.toFixed(2)}:${costBasis.toFixed(2)}) - remaining balance: ${balance.toFixed(4)} (${(balance * currentPrice).toFixed(2)} ${App.locale.currency})`,
        );
        Terminal.log('\r');
      }
      closeDate = prevOrder.closeDate;
      dataDeals.push({
        index: dealIndex++,
        openDate: openDate,
        closeDate: closeDate,
        costBasis: Number(costBasis.toFixed(2)),
        proceeds: proceeds > 0 ? Number(proceeds.toFixed(2)) : Number((balance * currentPrice).toFixed(2)),
        currency: lastOrder.pair.split('/')[1],
        reliable: balance >= 0 && balance * lastOrder.price < 1,
      });
      balance = 0;
      costBasis = 0;
      proceeds = 0;
    }

    var buyOrders = [];
    var sellOrders = [];
    /** @type {TraderDeal[]} */
    var deals = [];

    var botId = this.#botSettings.id;
    var account = this.#client.id;
    /**
     *
     * @param {ExchangeOrder} lastOrder
     */
    function saveDeal(lastOrder) {
      if (buyOrders.length > 0) {
        var deal = new TraderDeal({
          index: dealIndex,
          botId: botId,
          buyOrders: buyOrders,
          sellOrders: sellOrders,
          account: account,
          status: lastOrder.side === 'sell' ? 'closed' : 'open',
        });
        deals.push(deal);
      }
      buyOrders = [];
      sellOrders = [];
    }

    for (let i = 0; i < orders.length; i++) {
      let order = orders[i];
      let color = order.side === 'buy' ? cyanBright : greenBright;

      if (order.side === 'buy' && prevOrder?.side === 'sell' && balance <= 0.01) {
        if (saveTrades) savePnl(prevOrder);
        if (saveDeals) saveDeal(prevOrder);
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

      if (verbose) {
        try {
          var currency = order.pair.split('/')[1].toUpperCase();
        } catch (ex) {
          Terminal.printObject(order);
          Terminal.rethrow(ex);
        }
        Terminal.log(
          color`[${Utils.toShortDate(order.closeDate)}]: ${order.side} [${order.txid}] Vol: ${order.volume.toFixed(8)} / ${balance.toFixed(8)} (${(order.volume * order.price).toFixed(2)} ${currency} + ${order.fees.toFixed(2)} ${currency})`,
        );
      }

      if (typeof order !== 'undefined' && saveDeals) {
        if (order.side === 'buy') buyOrders.push(order.txid);
        else sellOrders.push(order.txid);
      }

      prevOrder = order;
    }

    if (saveTrades && prevOrder.isClosed && balance <= 0.01) savePnl(prevOrder);
    if (saveDeals && prevOrder.isClosed && balance <= 0.01) saveDeal(prevOrder);

    if (saveTrades) {
      App.writeFile(`${App.DataPath}/${this.#client.id}/${this.#botSettings.fileId}-trades`, dataDeals);
    }
    if (saveDeals) {
      var dealObject = {};
      for (let deal of deals) {
        dealObject[deal.id] = deal;
      }
      App.writeFile(`${App.DataPath}/${this.#client.id}/${this.#botSettings.fileId}-deals-recovered`, dealObject);
    }
  }

  calculatePnL(timeInterval = 'week') {
    var dataset = new Map();
    var account = this.#botSettings.account;
    var data = App.readFileSync(`${App.DataPath}/${account}/${this.#botSettings.fileId}-trades.json`);

    Terminal.warning(`Analysing ${data.length} trades`);

    /**
     *
     * @param {TradeData} trade
     * @returns {string}
     */
    function groupByWeek(trade) {
      var closeDate = new Date(trade.closeDate);
      var weekNumber = Utils.getWeekNumber(closeDate);
      var weekYear = Utils.getWeekYear(closeDate);
      var label = `${weekYear}-${weekNumber.toString().padStart(2, '0')}`;
      return label;
    }

    /**
     *
     * @param {TradeData} trade
     * @returns {string}
     */
    function groupByYear(trade) {
      var closeDate = new Date(trade.closeDate);
      var weekYear = Utils.getWeekYear(closeDate);
      return weekYear.toString();
    }

    /**
     *
     * @param {TradeData} trade
     * @returns {string}
     */
    function groupByMonth(trade) {
      var closeDate = new Date(trade.closeDate);
      const month = new Date(trade.closeDate).toLocaleString(App.locale.id, { month: '2-digit' });
      return `${closeDate.getFullYear()}-${month}`;
    }

    var groupByFunction;
    var fillFunction;

    switch (timeInterval) {
      default:
      case 'week':
        groupByFunction = groupByWeek;
        fillFunction = this.#fillMissingWeeks;
        break;

      case 'month':
        groupByFunction = groupByMonth;
        fillFunction = this.#fillMissingMonths;
        break;

      case 'year':
        groupByFunction = groupByYear;
        fillFunction = this.#fillMissingYears;
    }

    for (let i = 0; i < data.length; i++) {
      var trade = data[i];
      var label = groupByFunction(trade);
      if (!dataset.has(label)) dataset.set(label, { pnl: 0, reliable: true });
      var currentValue = dataset.get(label).pnl;
      let pnl = { pnl: currentValue + trade.proceeds - trade.costBasis, reliable: trade.reliable };
      dataset.set(label, pnl);
      // Terminal.warning(label);
      // Terminal.printObject(pnl);
      // Terminal.log(`CV: ${currentValue} tp: ${trade.proceeds} cb: ${trade.costBasis}`);
    }

    return fillFunction(dataset);
  }

  /**
   * We do not consider the case that we might not trade for an entire year.
   * Just return the converted array
   * @param {Map<string, TradeData>} dataset
   */
  #fillMissingYears(dataset) {
    var items = [];

    dataset.forEach((value, key) => {
      items.push([key, value]);
    });
    return items;
  }

  /**
   *
   * @param {Map<string, TradeData>} dataset
   */
  #fillMissingMonths(dataset) {
    function countMonths(startDate, endDate) {
      var months;
      var d1 = new Date(startDate);
      var d2 = new Date(endDate);
      months = (d2.getFullYear() - d1.getFullYear()) * 12;
      months -= d1.getMonth();
      months += d2.getMonth();
      return months <= 0 ? 0 : months;
    }

    function endOfMonth(date) {
      date.setDate(1); // Avoids edge cases on the 31st day of some months
      date.setMonth(date.getMonth() + 1);
      date.setDate(0);
      date.setHours(23);
      date.setMinutes(59);
      date.setSeconds(59);
      return date;
    }

    var items = [];
    var trades = [...dataset.keys()];
    var firstTradeArgs = trades[0].split('-');
    var lastTradeArgs = trades.at(-1).split('-');
    var startDate = new Date(trades[0]);
    var endDate = new Date(trades.at(-1));

    var delta = countMonths(startDate, endDate);
    var prevDate = startDate;
    for (let m = 0; m <= delta; m++) {
      var date = new Date(new Date(prevDate).setMonth(prevDate.getMonth() + m));
      var label = `${date.getFullYear()}-${date.toLocaleString(App.locale.id, { month: '2-digit' }).toString().padStart(2, '0')}`;
      if (!dataset.has(label)) {
        items.push([label, { pnl: 0, reliable: true }]);
      } else items.push([label, dataset.get(label)]);
    }
    return items;
  }

  /**
   *
   * @param {Map<string, TradeData>} dataset
   */
  #fillMissingWeeks(dataset) {
    function addMissingEntries(baseIndex, year, count) {
      for (let i = 1; i < count; i++) {
        let newKey = `${year}-${(baseIndex + i).toString().padStart(2, '0')}`;
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
        Terminal.error('Multi-year gaps not handled');
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
