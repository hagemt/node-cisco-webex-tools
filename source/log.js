const debug = require('debug')

const packageJSON = require('../package.json')
const debugLogger = debug(packageJSON.name)

module.exports = {
	debug: (...args) => debugLogger(...args),
}
