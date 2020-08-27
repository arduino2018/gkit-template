const {createG3} = require('g3.js');
const config = require('../config');
const g3 = createG3(config);
g3.deploy('build/MyContract', config.account);
