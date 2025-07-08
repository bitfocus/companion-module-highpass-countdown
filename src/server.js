import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export function setupWebServer(instance) {
	const app = express()
	const server = http.createServer(app)
	const io = new Server(server, {
		cors: {
			origin: '*',
		},
	})

	// Serve static files from the package root directory
	// The build process copies all files from public/ to the root
	app.use(express.static(process.cwd()))

	instance.log('info', `Web server serving static files from: ${process.cwd()}`)

	io.on('connection', (socket) => {
		instance.log('debug', 'Client connected to web server')

		// Send initial state
		socket.emit('state', instance.getFullState())

		socket.on('disconnect', () => {
			instance.log('debug', 'Client disconnected from web server')
		})

		instance.broadcastState()
	})

	const port = instance.config.port || 8880
	const host = '0.0.0.0' // Explicitly bind to all network interfaces
	
	server.listen(port, host, () => {
		instance.log('info', `Web server started on ${host}:${port}`)
		instance.log('info', `Access the timer from other devices at: http://<your-ip>:${port}`)
	})

	return {
		server,
		io,
	}
} 