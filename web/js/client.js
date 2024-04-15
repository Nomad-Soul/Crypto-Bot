var accounts = {};
var traderBotId;

document.addEventListener('DOMContentLoaded', function (event) {
  init();
  // document.getElementById('btn-run').addEventListener('click', function (e) {
  //   submitRequest('Ticker', { target: 'public', pair: 'btc/eur' });
  // });

  document.querySelectorAll('.nav-link').forEach(function (navLink) {
    navLink.addEventListener('click', function (e) {
      document.querySelectorAll('.nav-link').forEach((link) => link.classList.remove('active'));
      document.querySelectorAll('.tab').forEach((tab) => (tab.style.display = 'none'));
      document.getElementById(this.dataset.target).style.display = 'block';
      navLink.classList.add('active');
      if (navLink.getAttribute('data-target') != 'plannedOrders') document.getElementById('balance-container').parentElement.style.display = 'none';
      else document.getElementById('balance-container').parentElement.style.display = 'block';
    });
  });
  document.getElementById('btn-startDeal').addEventListener('click', (e) => submitRequest('StartDeal', { target: 'api', botId: traderBotId }));
  // document.getElementById('btn-cancelAll').addEventListener('click', (e) => submitRequest('CancelAll', { target: 'private' }));
  //document.getElementById('btn-testMode').addEventListener('change', (e) => toggleTestMode());
});

async function init() {
  await submitRequest('ClientSettings', {
    target: 'api',
  }).then((response) => {
    traderBotId = response.traderBotId;
    accounts = response.clientSettings;
    Object.keys(accounts).forEach((account) => {
      accounts[account].balances = new Map();
      var accountData = accounts[account];
      if (accountData.showDealPreview) receiveData('DealPreview', 'dealPreview', { target: 'api', botId: accountData.showDealPreview[0] });
      if (accountData.tradeBalance) {
        receiveData('TradeBalance', 'tradeHistory', { target: 'api', botId: accountData.tradeBalance[0] });
      }
      if (accountData.purchaseHistory) {
        receiveData('PurchaseHistory', 'stats', {
          target: 'api',
          botId: accountData.purchaseHistory.botId,
          interval: accountData.purchaseHistory.interval,
          startDate: new Date(accountData.purchaseHistory.startDate).getTime(),
        });
      }
    });
  });
  receiveData('ShowSchedule', 'plannedOrders', { target: 'api' });
  updateBalance();
  receiveData('ShowSchedule', 'plannedOrders', { target: 'api' });
  receiveData('ShowActivePlans', 'activePlans', { target: 'api' });

  // receiveData('DealPreview', 'dealPreview', { target: 'api', bot: 'bot-eth/eur', pair: 'btc/eur' });

  decide();
}

async function updateBalance() {
  var storeBalance = function (response, account) {
    console.log(response);
    for (const [key, value] of Object.entries(response)) {
      let readableKey = AliasForId(key);
      accounts[account].balances.set(readableKey, Number(value).toFixed(4));
    }
  };

  let accountIds = Object.keys(accounts);
  accountIds.forEach((account) => {
    submitRequest('Balance', { target: 'private', account: account }).then((response) => {
      storeBalance(response.balances, account);
      appendHtmlElement(response.html, 'balance-container');
    });
  });
}

async function sendRequest(request, params) {
  return submitRequest(request, params);
}

async function receiveData(request, container, params) {
  var promise = submitRequest(request, params).then((response) => {
    if (typeof response.html !== 'undefined') appendHtmlElement(response.html, container);
    if (typeof response.data !== 'undefined') formatChart(response);
  });
}

async function decide() {
  var response = await submitRequest('Decide', {
    target: 'api',
    pair: 'btceur',
  });

  response.data
    .filter((r) => r.result)
    .forEach((data) => {
      const toastElement = document.getElementById('liveToast');
      const toast = new bootstrap.Toast(toastElement);
      const toastBody = document.getElementById('liveToast-body');
      toastBody.innerText = `[${data.botId}]: ${data.status}`;
      toast.show();
    });

  console.log(response);
}

function AliasForId(id) {
  switch (id) {
    case 'ZEUR':
      return 'EUR';
    case 'XXBT':
      return 'BTC';

    default:
      return id;
  }
}

function appendHtmlElement(html, containerId) {
  var element = create(html);
  var container = document.getElementById(containerId);
  container.appendChild(element);
  return element;
}

function create(htmlStr) {
  var frag = document.createDocumentFragment(),
    temp = document.createElement('div');
  temp.innerHTML = htmlStr;
  while (temp.firstChild) {
    frag.appendChild(temp.firstChild);
  }
  return frag;
}

function cumulativeSums(values) {
  let total = 0;
  const sums = [];
  values.forEach((v) => {
    total += v;
    sums.push(total);
  });
  return sums;
}

async function formatChart(dataset) {
  var data = dataset.data;
  var container = document.getElementById(dataset.chartType);
  switch (dataset.chartType) {
    case 'candlestick': {
      var chart = new Chart(container, {
        type: 'candlestick',
        data: {
          datasets: [
            {
              label: dataset.pair.toUpperCase(),
              data: data,
              order: 0,
            },
            {
              label: 'Purchase price',
              type: 'line',
              data: dataset.purchases.map((entry) => ({ x: entry[0], y: entry[1] })),
              borderColor: 'rgb(255, 159, 64)',
              borderWidth: 4,
              order: 1,
              parsing: false,
            },
          ],
        },
        options: {
          plugins: {
            title: {
              display: true,
              text: 'Stackerbot purchase price vs market',
              font: { size: 14 },
            },
          },
          scales: {
            x: {
              type: 'time',
              time: {
                displayFormats: { day: 'yyyy MMM dd' },
                tooltipFormat: 'yyyy MMM dd',
                unit: 'day',
              },
            },
          },
        },
      });
      break;
    }

    case 'traderBot': {
      let pair = dataset.pair.toUpperCase().split('/');
      new Chart(document.getElementById(dataset.chartType), {
        type: 'line',
        data: {
          labels: data.map((item) => item[0]),
          datasets: [
            {
              label: `Pnl ${pair[1]}`,
              fill: true,
              data: cumulativeSums(data.map((item) => item[1].pnl)),
              pointBackgroundColor: data.map((item) => (item[1].reliable ? 'rgb(54, 162, 235)' : 'rgb(255, 99, 132)')),
              pointBorderColor: data.map((item) => (item[1].reliable ? 'rgb(54, 162, 235)' : 'rgb(255, 99, 132)')),
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: 'top',
            },
            title: {
              display: true,
              text: `TraderBot cumulative PnL per week (${dataset.pair})`,
              font: { size: 14 },
            },
          },
        },
      });
      break;
    }

    case 'stackerBot': {
      var botId = Object.values(accounts).find((account) => typeof account.stackingHistory?.botIds != 'undefined').stackingHistory.botIds[0];
      var botData = data[botId];
      let currencyLabels = [botData.base, botData.quote];
      new Chart(document.getElementById(dataset.chartType), {
        type: 'bar',
        data: {
          labels: Object.keys(botData).slice(0, 2),
          datasets: [
            {
              label: `${currencyLabels[0]} bought`,
              yAxisID: 'y',
              type: 'bar',
              order: 1,
              fill: true,
              data: Array.from(Object.values(botData)).map((entry) => entry.volume),
            },
            {
              label: `${currencyLabels[0]} paid`,
              type: 'line',
              yAxisID: 'yQuote',
              order: 0,
              fill: true,
              data: Array.from(Object.values(botData)).map((entry) => entry.volumeQuote),
            },
          ],
        },
        options: {
          responsive: true,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          stacked: false,
          plugins: {
            title: {
              display: true,
              text: `${currencyLabels[0]} bought every month (${currencyLabels[1]})`,
              font: { size: 14 },
            },
            tooltip: {
              callbacks: {
                label: (value) => `${value?.parsed?.y.toFixed(4)} ${currencyLabels[value?.datasetIndex]}`,
              },
            },
          },
          scales: {
            y: {
              type: 'linear',
              display: true,
              position: 'left',
            },
            yQuote: {
              type: 'linear',
              display: true,
              position: 'right',
              grid: {
                color: 'rgb(32,32,32)',
                drawOnChartArea: false,
              },
            },
            x: {
              grid: {
                color: 'rgb(32,32,32)',
              },
            },
          },
        },
      });
      break;
    }
  }
}

/**
 *
 * @param {string} command
 * @param {any} data
 * @returns {Promise}
 */
async function submitRequest(command, data) {
  return new Promise(function (resolve, reject) {
    let xhr = new XMLHttpRequest();
    xhr.responseType = 'json';
    xhr.data = data;

    let mode = data.mode ?? 'GET';
    mode = mode.toUpperCase();
    let url = 'api';

    if (mode === 'GET') {
      url += `?endpoint=${command}`;
      let excludedKeys = ['mode', 'endpoint'];
      for (const [key, value] of Object.entries(data)) {
        if (excludedKeys.includes(key)) continue;
        url += `&${key}=${value}`;
      }
    }

    xhr.open(mode, url);
    xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
    xhr.setRequestHeader('accept', 'application/json');

    xhr.onload = function () {
      if (this.status >= 200 && this.status < 300) {
        resolve(xhr.response);
      } else {
        reject({
          status: this.status,
          statusText: xhr.statusText,
        });
      }
    };
    xhr.onerror = function () {
      reject({
        status: this.status,
        statusText: xhr.statusText,
      });
    };

    if (mode === 'POST') {
      if (typeof data.content.request === 'undefined') {
        data.content.request = command;
      }
      xhr.send(JSON.stringify(data.content));
    } else xhr.send();
    console.log(`[${command}]: sent ${mode} request`);
  });
}
