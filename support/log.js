const createDebugLog = require('debug')

const packageJSON = require('../package.json')
const defaultDebugLog = createDebugLog(packageJSON.name)

module.exports = {
	create: (...args) => createDebugLog(...args),
	debug: (...args) => defaultDebugLog(...args),
}
