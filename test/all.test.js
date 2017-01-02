const chai = require('chai')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')
const should = chai.should()
chai.use(sinonChai)

const config = require('../config.testing')
const server = require('./mock-server')
const RohrpostClient = require('../')

const PORT = 9436
const WS_URL = 'ws://localhost:9436'
// const WS_URL = 'wss://api-stage.ax-semantics.com/ws/rohrpost/'
let client = null
describe('Rohrpost Client', () => {
	before(function (done) {
		server.init({
			port: PORT
		}, done)
	})
	it('should connect', (done) => {
		client = new RohrpostClient(WS_URL, {pingInterval: 500, token: config.jwt})
		client.once('open', done)
	})
	it('should ping', (done) => {
		let counter = 0
		const count = () => {
			client.once('pong', () => {
				counter++
				if (counter >= 3) done()
				else count()
			})
		}
		count()
	}).timeout(1500)
	// it('should subscribe', (done) => {
	// 	client.subscribe({type:'collection', id: 52})
	// })
})
