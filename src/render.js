import App from './app.js';
import CryptoBot from './crypto-bot.js';
import BotSettings from './data/bot-settings.js';
import EcaOrder from './data/eca-order.js';
import PairData from './data/pair-data.js';
import TraderDeal from './data/trader-deal.js';
import DealPlanner from './strategies/deal-planner.js';
import Utils from './utils.js';

export default class Renderer {
  #currency;
  #bot;

  /**
   *
   * @param {CryptoBot} bot
   */
  constructor(bot) {
    this.#bot = bot;
    this.#currency = Intl.NumberFormat(App.locale, { style: 'currency', currency: bot.appCurrency });
  }

  reportMissingOrders() {
    let data = this.#bot.getPlannedOrders('all');
    var filtered = data.filter((order) => !this.#bot.getClient(order.account).hasLocalExchangeOrder(order.txid)).map((order) => order.txid);
    return filtered;
  }

  async renderOrderSchedule() {
    this.reportMissingOrders();
    let data = this.#bot.getPlannedOrders('all');
    var html = '';

    var accountClient;
    var sortedData = data.sort((a, b) => b.openDate.getTime() - a.openDate.getTime());
    for (let i = 0; i < sortedData.length; i++) {
      let order = data[i];
      let botSettings = this.#bot.getBotSettings(order.botId);
      let price = this.#bot.getPrice(botSettings.pair);
      let cost = 0;
      let volume = order.volumeQuote / price;
      let date = order.closeDate ?? order.openDate;
      let dateClass = '';
      let costClass = 'text-warning';
      let status = order.status;
      let statusClass = 'text-neutral';
      let exchangeOrder = {};
      accountClient = this.#bot.getClient(order.account);

      if (typeof order.txid != 'undefined') {
        exchangeOrder = await accountClient.getExchangeOrder(order.txid);
      }
      if (order.status == 'executed') {
        if (typeof exchangeOrder != 'undefined') {
          volume = exchangeOrder.volume;
          cost = exchangeOrder.cost;
          if (exchangeOrder.status === 'closed' || exchangeOrder.status === 'FILLED') {
            costClass = 'text-success';
            date = exchangeOrder.closeDate;
          } else {
            statusClass = 'text-danger';
            date = exchangeOrder.openDate;
          }
        }
      } else if (order.status === 'pending') {
        statusClass = 'text-info';
        volume = exchangeOrder.volume;
        cost = price * Math.max(volume, botSettings.minVolume);
        date = exchangeOrder.openDate;
      } else if (order.status === 'planned') {
        cost = 0;
        date = new Date(order.openDate);
        if (order.isScheduledForToday) {
          statusClass = dateClass = 'text-info';
        } else statusClass = dateClass = 'text-primary';
      }

      // order.openDate = exchangeOrder.openDate;
      // order.closeDate = exchangeOrder.closeDate;
      // order.volumeQuote = exchangeOrder.cost;

      if (typeof date === 'undefined') date = order.closeDate;

      //console.log(order);
      try {
        html += `<div class="row mt-2" data-id="${order.id ?? ''}">
        <div class="col-md-1 col-2 text-start"><span class="badge ${botSettings.badgeClass}">${botSettings.base}</span></div>
        <div class="col-md-2 col-5 text-start ${dateClass}" title="${Utils.toShortTime(date)}">${Utils.toShortDate(date)}</div>
        <div class="col-md-1 col-2 text-start ${statusClass}">${order.direction}</div>
        <div class="col-md-2 col-3 text-end ${costClass}">${Number(volume).toFixed(4)}</div>
        <div class="col-md-2 col-4 text-end order-md-1 order-2 ${costClass}">${cost > 0 ? this.#currency.format(cost) : '-'}</div>
        <div class="col-md-2 col-4 text-start ${statusClass}" title="${order.txid}" >${status}</div>
        <div class="col-md-2 col-4 text-start text-neutral">${order.account}</div>
    </div>`;
      } catch (e) {
        App.printObject(order);
        App.printObject(exchangeOrder);
        App.error(`Invalid data: ${order.id}`);
      }
    }
    //this.#bot.updatePlanSchedule();
    return { html: html };
  }

  async renderActiveBots() {
    var bots = this.#bot.getAllBots();
    var botIds = Object.keys(bots);

    var html = `<div class="row mt-2 text-neutral">
      <div class="col-md-2 d-md-block d-none text-md-end">ECA</div>
      <div class="col-md-1 d-md-block d-none text-end">Type</div>
      <div class="col-md-2 d-md-block d-none text-md-end">Frequency</div>
      <div class="col-md-1-5 d-md-block d-none text-md-center text-center">Last</div>
      <div class="col-md-1 d-md-block d-none text-md-start">Exchange</div>
      <div class="col-md-1-5 col-5 text-md-end text-end">Cost Basis</div>
      <div class="col-md-1-5 col-4 text-md-end text-end">Total €</div>
      <div class="col-md-1-5 col-3 text-md-end text-end">Total Vol</div>
    </div>
    `;

    var dataset = new Map();
    for (let i = 0; i < botIds.length; i++) {
      let botSettings = bots[botIds[i]];
      if (!botSettings.active || botSettings.strategyType != 'eca-stacker') continue;

      var accountClient = this.#bot.getClient(botSettings.account);
      let data = this.#bot
        .getPlannedOrders(botIds[i])
        .filter((p) => p.status === 'executed')
        .map((p) => p.txid);

      var exchangeOrders = [];
      for (let idxPlan = 0; idxPlan < data.length; idxPlan++) {
        const txid = data[idxPlan];
        var exchangeOrder = await accountClient.getExchangeOrder(txid);
        exchangeOrders.push(exchangeOrder);
      }

      //console.log(exchangeOrders);

      let weightedAverage = exchangeOrders.reduce(
        (accumulator, order) => [
          {
            weightedSum: accumulator[0].weightedSum + order.cost + order.fees,
            sum: accumulator[0].sum + order.volume,
          },
        ],
        [{ weightedSum: 0, sum: 0 }],
      );

      let pair = botSettings.pair;
      let pairData = accountClient.getPairData(pair);
      let groupByMonth = exchangeOrders.reduce((groupBy, order) => {
        const month = order.closeDate.toLocaleString(App.locale.id, { month: 'long' });
        if (!Object.hasOwn(groupBy, month)) groupBy[month] = { volume: 0, volumeQuote: 0, fees: 0 };
        groupBy[month].volume += order.volume;
        groupBy[month].volumeQuote += order.cost;
        groupBy[month].fees += order.fees;
        return groupBy;
      }, {});

      groupByMonth.base = pairData.base;
      groupByMonth.quote = pairData.quote;
      dataset.set(botIds[i], groupByMonth);

      let currentPrice = Number(this.#bot.getPrice(pair));

      let desiredAmount = Math.max(botSettings.maxVolumeQuote, pairData.minVolume * currentPrice);
      let costBasis = weightedAverage.map((value) => value.weightedSum / value.sum)[0];
      let costUnit = '';
      if (costBasis > 10000) {
        costBasis /= 1000;
        costUnit = 'k';
      }
      let totalVolumeBought = weightedAverage.map((value) => value.sum)[0];
      let totalSpent = weightedAverage[0].weightedSum;
      let frequency = Number(botSettings.options.frequency);
      let frequencyText = `${frequency.toFixed(2)} h`;
      if (botSettings.options.type != 'recurring') {
        frequencyText = `on the ${botSettings.options.day}`;
      }

      let averageClass = 'text-neutral';
      let amountClass = 'text-success';
      if (currentPrice > costBasis) averageClass = 'text-success';
      else averageClass = 'text-danger';

      var executedOrders = this.#bot.getPlannedOrders(botIds[i]).filter((o) => o.status === 'executed');
      var lastDateString = 'never';
      if (executedOrders.length > 0)
        lastDateString = executedOrders[executedOrders.length - 1].closeDate.toLocaleString(App.locale, {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
        });

      if (desiredAmount > botSettings.maxVolumeQuote) amountClass = 'text-danger';

      html += `<div class="row mt-2" data-groupBy="${JSON.stringify(groupByMonth)}">
        <div class="col-md-1 col-2 text-start"><span class="badge ${botSettings.badgeClass}">${botSettings.base}</span></div>
        <div class="col-md-1 d-md-block d-none text-end ${amountClass}">${Number(desiredAmount).toFixed(2)}</div>
        <div class="col-md-1 d-md-block d-none text-end">${botSettings.options.type}</div>
        <div class="col-md-2 d-md-block d-none text-md-end">${frequencyText}</div>
        <div class="col-md-1-5 d-md-block d-none text-start">${lastDateString}</div>
        <div class="col-md-1 d-md-block d-none text-md-start small">${botSettings.account}</div>
        <div class="col-md-1-5 col-3 text-md-end text-end ${averageClass}">${Number(costBasis).toFixed(2)}${costUnit}</div>
        <div class="col-md-1-5 col-4 text-end text-info">${Number(totalSpent).toFixed(2)}&thinsp;€</div>
        <div class="col-md-1-5 col-3 text-end text-info">${Number(totalVolumeBought).toFixed(Math.min(pairData.minBaseDisplayDigits, 4))}</div> 

      </div>`;
    }

    return { html: html, data: Object.fromEntries(dataset.entries()), chartType: 'stackerBot' };
  }

  /**
   *
   * @param {string} accountId
   * @returns
   */
  renderBalanceBlocks(accountId) {
    var accountClient = this.#bot.getClient(accountId);

    var html = `<div class="col-md-3 col-5 p-4 rounded bg-dark-container me-4 mb-2">
    <div class="row">
      <div class="col"><h4>${accountId.charAt(0).toUpperCase() + accountId.slice(1)}</h4></div>
    </div>`;
    [...accountClient.balances.keys()].forEach((key) => {
      var pairData = accountClient.getPairData(`${PairData.GetAliasCurrency(key)}/${this.#bot.appCurrency}`);
      var minBaseDisplayDigits = pairData?.minBaseDisplayDigits || 2;

      let balance = accountClient.balances.get(key);
      if (accountClient.watchBalance.includes(key) && balance > 0) {
        html += `<div class="row">
          <div class="col-3 text-start">
            <span id="bal-${key}-id" class="badge bg-primary">${key}</span>
          </div>
        <div class="col-9 text-end" >
          <span id="bal-${key}-value" >${balance.toFixed(minBaseDisplayDigits)}</span>
        </div>
      </div>`;
      }
    });
    // [...accountClient.balances.entries()].forEach(([key, value]) => {});
    html += '</div>';
    return { html: html };
  }

  /**
   *
   * @param {EcaOrder[]} orders
   * @param {any} accountSettings
   * @returns
   */
  renderDealPreviewTotal(orders, accountSettings) {
    const { makerFees, takerFees } = accountSettings;
    var total = orders.reduce((sum, order) => {
      let volumeCurrency = Number(order.volumeQuote);
      let fees = Number(order.fees);
      sum += volumeCurrency + fees;
      return sum;
    }, 0);

    let volume = Number(orders[orders.length - 1].volume);
    let sellCurrency = Number(orders[orders.length - 1].volumeQuote);
    let sellFees = Number(orders[orders.length - 1].fees);
    let buyCurrency = Number(orders[0].volumeQuote);
    let buyFees = Number(orders[0].fees);
    let buyPrice = Number(orders[0].price);
    //App.warning([sellCurrency, makerFees, sellCurrency, buyCurrency, buyFees]);
    let profit = sellCurrency - sellFees - buyCurrency - buyFees;
    let margin = profit / (buyCurrency - buyFees);
    let lastSO = Number(orders.filter((o) => o.direction === 'buy').slice(-1)[0].price);

    return `
      <div class="row border-top">
          <div class="col-4 text-start fw-bold">Total:</div>
          <div class="col-2 text-end">${total.toFixed(2)} €</div>
          <div class="col-2 text-start fw-bold">Profit</div>
          <div class="col-4 text-end text-success">${(margin * 100).toFixed(2)}% (${profit.toFixed(2)}€)</div>
    </div>
    <div class="row mb-4">
          <div class="col-6 text-start"></div>
          <div class="col-4 text-start fw-bold">Deviation</div>
          <div class="col-2 text-end text-danger">${(100 - (lastSO / buyPrice) * 100).toFixed(2)} %</div>
    </div>
  </div>`;
  }

  /**
   *
   * @param {EcaOrder} orderData
   * @param {PairData} pairData
   * @returns
   */
  renderOrder(orderData, pairData) {
    let textClass = orderData.direction === 'sell' ? 'text-success' : 'text-danger';
    let iconClass = orderData.direction === 'sell' ? 'bi-arrow-up' : 'bi-arrow-down';
    var datestring = Utils.toShortDate(orderData.closeDate ?? orderData.openDate);

    let orderPrice = Number(orderData.price);
    let base = pairData.base.toUpperCase();
    let quote = pairData.quote.toUpperCase();
    let vol = Number(orderData.volume);
    let volEuro = vol * orderPrice;
    let feeEuro = Number(orderData.fees);

    let row = `
      <div class="row">
          <div class="col-3 text-start">${datestring}</div>
          <div class="col-2-5 text-start fw-bold ${textClass}"><i class="bi ${iconClass}"></i>${orderData.direction} ${orderData.type}</div>
          <div class="col-1-5 text-end text-info">${volEuro.toFixed(2)} €</div>
          <div class="col-1-5 text-end text-danger">${feeEuro.toFixed(2)} €</div>
          <div class="col-3-5 text-end">${vol.toFixed(4)} ${base} @ ${orderPrice.toFixed(2)} ${quote}</div>
      </div>`;

    return row;
  }

  /**
   *
   * @param {string} botId
   * @param {EcaOrder[]} orders
   * @returns
   */
  renderPreview(botId, orders) {
    var botSettings = this.#bot.getBotSettings(botId);
    var accountClient = this.#bot.getClient(botSettings.account);
    var pairData = accountClient.getPairData(botSettings.pair);
    var html = '<div class="bg-dark-container p-md-4 p-2 mt-4"> <div class="row"><h4>New deal preview</h4></div>';
    for (const order of orders) {
      html += this.renderOrder(order, pairData);
    }

    html += this.renderDealPreviewTotal(orders, { makerFees: accountClient.makerFees, takerFees: accountClient.takerFees });
    return { html: html };
  }

  /**
   *
   * @param {TraderDeal} openDeal
   */
  renderOpenDeal(openDeal) {
    if (!openDeal) {
      return {
        html: `<div class="bg-dark-container p-md-4 p-2"><div class="row">
    <h5 class="text-start">No active deals</h5>
  </div></div>`,
      };
    }
    var dealPlanner = new DealPlanner(this.#bot, openDeal.botId);
    var accountClient = this.#bot.getClient(openDeal.account);
    var botSettings = this.#bot.getBotSettings(openDeal.botId);
    var pairData = accountClient.getPairData(botSettings.pair);

    let orders = openDeal.orders.map((id) => this.#bot.getPlannedOrder(id));
    let closedOrders = orders
      .filter((order) => order.isClosed)
      .sort((a, b) => a.closeDate.getTime() - b.closeDate.getTime())
      .map((order) => this.#bot.getLocalExchangeOrderFromPlannedOrderId(order.id, openDeal.account));
    let nextBuyOrder = orders.find((order) => !order.isClosed && order.direction === 'buy') ?? dealPlanner.calculateSafetyOrder(openDeal);
    let takeProfitOrder = openDeal.sellOrders[0] ? this.#bot.getPlannedOrder(openDeal.sellOrders[0]) : dealPlanner.proposeTakeProfitOrder(openDeal);

    let safetyOrderPrice = nextBuyOrder.price;
    let takeProfitPrice = takeProfitOrder.price;
    const { averagePrice, costBasis, profitTarget } = openDeal.calculateProfitTarget(this.#bot, botSettings);
    let currentPrice = this.#bot.getPrice(nextBuyOrder.pair);

    let deltaSafety = (takeProfitPrice - safetyOrderPrice) / 2;
    let widthPnL =
      currentPrice > averagePrice
        ? (50 * (currentPrice - averagePrice)) / (takeProfitPrice - averagePrice)
        : (50 * (currentPrice - averagePrice)) / (averagePrice - safetyOrderPrice);
    let widthLoss = Math.min(widthPnL < 0 ? Math.abs(widthPnL) : 0, 50);
    let widthSafety = widthPnL < 0 ? 50 - widthLoss : 50;

    let widthProfit = widthPnL < 0 ? 0 : widthPnL;

    let volumeProfit = Number(takeProfitOrder.volume);
    let volumeProfitQuote = volumeProfit * takeProfitPrice;
    let volumeSafetyQuote = Number(nextBuyOrder.volume * safetyOrderPrice);
    let pnlType = widthPnL < 0 ? 'text-danger' : 'text-success';
    let pnlPercent = (100 * (currentPrice - averagePrice)) / averagePrice;
    let pnlValue = volumeProfit * currentPrice - averagePrice * volumeProfit;
    let profitPotential = volumeProfitQuote - volumeProfit * averagePrice - volumeProfitQuote * 0.0016;
    let profitPercent = 100 * ((takeProfitPrice - averagePrice) / averagePrice - 0.0016);

    let labelLoss = widthPnL < 0 ? currentPrice : '';
    let labelProfit = widthPnL < 0 ? '' : currentPrice;

    var quoteCurrency = pairData.quote.toUpperCase();

    let dealTemplate = `
    <div class="bg-dark-container p-md-4 p-2"><div class="row">
      <div class="col-9">
        <h5 class="text-start">Active <span class="text-info">${pairData.id}</span> deal: <code>${openDeal.id}</code> </h5>
      </div>
      <div class="col-3 text-end text-neutral">
        <h5>${Utils.timeToHoursOrDaysText(orders.at(0).hoursElapsed())} old</h5>
      </div>
    </div>
      <div class="row">
          <div class="col-4 text-start">${safetyOrderPrice.toFixed(2)}</div>
          <div class="col-4 text-center">${averagePrice.toFixed(2)}</div>
          <div class="col-4 text-end">${takeProfitPrice.toFixed(2)}</div>
      </div>
      <div class="row">
          <div class="col">
              <div class="progress">
                  <div class="progress-bar bg-secondary" role="progressbar" style="width: ${widthSafety.toFixed(4)}%" aria-valuenow="${widthSafety.toFixed(4)}" aria-valuemin="0" aria-valuemax="100"></div>
                  <div class="progress-bar bg-danger text-start" role="progressbar" style="width: ${widthLoss.toFixed(4)}%; overflow:visible" aria-valuenow="${widthLoss.toFixed(4)}" aria-valuemin="0" aria-valuemax="100">${labelLoss !== '' ? labelLoss.toFixed(pairData.maxQuoteDigits) : ''}</div>
                  <div class="progress-bar bg-success text-end" role="progressbar" style="width: ${widthProfit.toFixed(4)}%; overflow:visible" aria-valuenow="${widthProfit.toFixed(4)}" aria-valuemin="0" aria-valuemax="100">${labelProfit !== '' ? labelProfit.toFixed(pairData.maxQuoteDigits) : ''}</div>
              </div>
          </div>
      </div>
      <div class="row">
          <div class="col-6">
              PnL: <span class="${pnlType}">${pnlPercent.toFixed(2)}% (${pnlValue.toFixed(2)} €)</span>
          </div>
          <div class="col-6">
              Potential: <span class="text-success">${profitPercent.toFixed(2)}% (${profitPotential.toFixed(2)} €)</span>
          </div>
      </div>
      <div class="row">
        <p class="lead text-start">Next safety order: buy ${nextBuyOrder.volume} ${pairData.base} @ ${nextBuyOrder.price.toFixed(2)} (${(nextBuyOrder.volume * nextBuyOrder.price).toFixed(2)} ${quoteCurrency})</p>
      </div>
      `;

    for (let i = 0; i < closedOrders.length; i++) {
      let order = closedOrders[i];
      if (order.status === 'open') continue;
      dealTemplate += `<div class="row">
        <div class="col text-start">
          <span class="text-danger">${order.type}</span> ${order.side} <span class="text-info">${Number(order.volume).toFixed(4)}</span> @ <span class="text-info">${Number(order.price).toFixed(2)}  </span> (${(order.volume * order.price).toFixed(2)} ${quoteCurrency}) on ${Utils.toShortDateTime(order.closeDate)}
        </div>
      </div>`;
    }
    dealTemplate += '</div>';
    return { html: dealTemplate };
  }
}
