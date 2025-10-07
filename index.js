const axios = require('axios');

const URL = 'http://192.168.1.37:8089/api/v2/nodes/1747959817832/statistics';

async function main() {
  try {
    console.time('fetching statistics');
    const response = await axios.get(URL, { timeout: 10000 });

    let items = response.data;
    if (!Array.isArray(items)) {
      if (items && Array.isArray(items.data)) {
        items = items.data;
      } else {
        throw new Error('Unexpected response format: expected an array or an object with a data array');
      }
    }

    const totalCount = items.reduce((sum, item) => {
      const raw = item && Object.prototype.hasOwnProperty.call(item, 'count') ? item.count : 0;
      const value = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);

    console.timeEnd('fetching statistics');
    console.log(totalCount);
  } catch (error) {
    console.error('Error fetching statistics:', error.message);
    process.exitCode = 1;
  }
}

main();