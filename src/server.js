import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import fs from 'fs'
import path from 'path'

export function setupWebServer(instance) {
	const app = express()
	const server = http.createServer(app)
	const io = new Server(server, {
		cors: {
			origin: '*',
		},
	})

	// Find the module directory - in production, files are in the same directory as main.js
	// In development, they're in the public/ directory relative to src/
	let staticDir = process.cwd()
	
	// Try to detect if we're in a packaged module by checking for main.js
	try {
		// Check if main.js exists in current directory (production)
		if (fs.existsSync(path.join(process.cwd(), 'main.js'))) {
			staticDir = process.cwd()
			instance.log('info', 'Detected production environment - serving from module root')
		} else {
			// Development mode - serve from public directory
			staticDir = path.join(process.cwd(), 'public')
			instance.log('info', 'Detected development environment - serving from public/')
		}
	} catch (error) {
		instance.log('warn', `Error detecting environment: ${error.message}`)
		staticDir = process.cwd()
	}

	app.use(express.static(staticDir))
	instance.log('info', `Web server serving static files from: ${staticDir}`)

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