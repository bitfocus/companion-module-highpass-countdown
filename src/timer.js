import {
	InstanceBase,
	InstanceStatus,
	runEntrypoint,
	combineRgb,
} from '@companion-module/base'
import { setupWebServer } from './server.js'
import http from 'http'
import { Server } from 'socket.io'


export class CountdownTimer extends InstanceBase {
	
	constructor(internal) {
		super(internal)
	}

	async init(config) {
		this.updateStatus(InstanceStatus.Ok)
		await this.configUpdated(config)

		this.timer_state = 'stopped'
		this.timer_remaining = 0
		this.last_set_time = 0
		this.timer_interval = null
		this.top_aux_text = ''
		this.bottom_aux_text = ''

		this.init_actions()
		this.init_feedbacks()
		this.init_presets()
		this.init_variables()
	}

	async destroy() {
		if (this.timer_interval) {
			clearInterval(this.timer_interval)
			this.timer_interval = null
		}
		if (this.server) {
			this.server.close()
		}
		this.log('debug', 'destroy')
	}

	async configUpdated(config) {
		this.config = config
		if (this.server) {
			this.server.close(() => {
				this.init_webserver()
			})
		} else {
			this.init_webserver()
		}
	}

	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'port',
				label: 'Web Server Port',
				width: 6,
				default: '8080',
			},
			{
				type: 'checkbox',
				id: 'show_internal_time',
				label: 'Show Internal Time',
				default: false,
			},
			{
				type: 'dropdown',
				id: 'time_corner',
				label: 'Time Corner',
				default: 'top-left',
				choices: [
					{ id: 'top-left', label: 'Top Left' },
					{ id: 'top-right', label: 'Top Right' },
					{ id: 'bottom-left', label: 'Bottom Left' },
					{ id: 'bottom-right', label: 'Bottom Right' },
				],
			},
			{
				type: 'number',
				id: 'amber_time',
				label: 'Amber Time (seconds)',
				width: 6,
				default: 180,
				min: 1,
				max: 7200,
			},
			{
				type: 'number',
				id: 'red_time',
				label: 'Red Time (seconds)',
				width: 6,
				default: 60,
				min: 1,
				max: 7200,
			},
			{
				type: 'number',
				id: 'timer_fontsize',
				label: 'Timer Font Size (vw)',
				width: 6,
				default: 15,
				min: 1,
				max: 100,
			},
			{
				type: 'number',
				id: 'aux_fontsize',
				label: 'Aux Font Size (vw)',
				width: 6,
				default: 5,
				min: 1,
				max: 50,
			},
		]
	}

	init_actions() {
		this.setActionDefinitions({
			set_timer: {
				name: 'Set Timer',
				options: [
					{
						type: 'textinput',
						id: 'time',
						label: 'Time (HH:MM:SS)',
						default: '00:05:00',
						regex: '/^\\d{2}:\\d{2}:\\d{2}$/',
					},
				],
				callback: async (action) => {
					const time = action.options.time
					const parts = time.split(':').map(Number)
					if (parts.length === 3) {
						const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
						this.set_timer(seconds)
					}
				},
			},
			control: {
				name: 'Control Timer',
				options: [
					{
						type: 'dropdown',
						id: 'action',
						label: 'Action',
						default: 'start',
						choices: [
							{ id: 'start', label: 'Start' },
							{ id: 'pause', label: 'Pause' },
							{ id: 'stop', label: 'Stop' },
						],
					},
				],
				callback: async (action) => {
					if (action.options.action === 'start') {
						this.start_timer()
					} else if (action.options.action === 'pause') {
						this.pause_timer()
					} else if (action.options.action === 'stop') {
						this.stop_timer()
					}
				},
			},
			add_time: {
				name: 'Add Time',
				options: [
					{
						type: 'textinput',
						id: 'time',
						label: 'Time (HH:MM:SS)',
						default: '00:01:00',
						regex: '/^\\d{2}:\\d{2}:\\d{2}$/',
					},
				],
				callback: async (action) => {
					const time = action.options.time
					const parts = time.split(':').map(Number)
					if (parts.length === 3) {
						const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
						this.timer_remaining += seconds
						this.update_variables()
						this.broadcastState()
					}
				},
			},
			subtract_time: {
				name: 'Subtract Time',
				options: [
					{
						type: 'textinput',
						id: 'time',
						label: 'Time (HH:MM:SS)',
						default: '00:01:00',
						regex: '/^\\d{2}:\\d{2}:\\d{2}$/',
					},
				],
				callback: async (action) => {
					const time = action.options.time
					const parts = time.split(':').map(Number)
					if (parts.length === 3) {
						const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
						this.timer_remaining -= seconds
						this.update_variables()
						this.broadcastState()
					}
				},
			},
			set_top_aux: {
				name: 'Set Top Aux Text',
				options: [
					{
						type: 'textinput',
						id: 'text',
						label: 'Text',
						default: '',
						useVariables: true,
					},
				],
				callback: async (action) => {
					const text = await this.parseVariablesInString(action.options.text)
					this.top_aux_text = text
					this.broadcastState()
				},
			},
			set_bottom_aux: {
				name: 'Set Bottom Aux Text',
				options: [
					{
						type: 'textinput',
						id: 'text',
						label: 'Text',
						default: '',
						useVariables: true,
					},
				],
				callback: async (action) => {
					const text = await this.parseVariablesInString(action.options.text)
					this.bottom_aux_text = text
					this.broadcastState()
				},
			},
		})
	}

	init_feedbacks() {
		const feedbacks = {
			state_color: {
				type: 'advanced',
				name: 'Timer State Color',
				description: 'Change color based on timer state',
				options: [],
				callback: ({ options }) => {
					let style = {
						color: combineRgb(255, 255, 255),
						bgcolor: combineRgb(0, 0, 0),
					}

					if (this.timer_state === 'running') {
						style.bgcolor = combineRgb(0, 204, 0) // Green

						if (this.config.red_time && this.timer_remaining > 0 && this.timer_remaining <= this.config.red_time) {
							style.bgcolor = combineRgb(204, 0, 0) // Red
						} else if (
							this.config.amber_time &&
							this.timer_remaining > 0 &&
							this.timer_remaining <= this.config.amber_time
						) {
							style.bgcolor = combineRgb(255, 128, 0) // Amber
						}
					} else if (this.timer_state === 'paused') {
						style.bgcolor = combineRgb(255, 128, 0) // Amber
					}

					return style
				},
			},
			selected_time: {
				type: 'boolean',
				name: 'Is Selected Time',
				description: 'Change style if the time is the last one set',
				defaultStyle: {
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(0, 0, 255), // Blue
				},
				options: [
					{
						type: 'number',
						id: 'time',
						label: 'Time (seconds)',
						default: 300,
					},
				],
				callback: (feedback) => {
					return this.last_set_time === feedback.options.time
				},
			},
		}
		this.setFeedbackDefinitions(feedbacks)
	}

	init_presets() {
		const presets = {}
		const foregroundColor = combineRgb(255, 255, 255)
		const backgroundColor = combineRgb(0, 0, 0)

		presets['timer_display'] = {
			type: 'button',
			category: 'Timer Display',
			name: 'Timer Display with State Colors',
			style: {
				text: `$(internal:timer_hms)`,
				size: '18',
				color: foregroundColor,
				bgcolor: backgroundColor,
			},
			steps: [
				{
					down: [{ actionId: 'control', options: { action: 'start' } }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'state_color',
					options: {},
				},
			],
		}

		presets['start_timer'] = {
			type: 'button',
			category: 'Timer Control',
			name: 'Start Timer',
			style: {
				text: 'START',
				size: '18',
				color: foregroundColor,
				bgcolor: combineRgb(0, 204, 0),
			},
			steps: [
				{
					down: [{ actionId: 'control', options: { action: 'start' } }],
					up: [],
				},
			],
			feedbacks: [],
		}

		presets['pause_timer'] = {
			type: 'button',
			category: 'Timer Control',
			name: 'Pause Timer',
			style: {
				text: 'PAUSE',
				size: '18',
				color: foregroundColor,
				bgcolor: combineRgb(255, 128, 0),
			},
			steps: [
				{
					down: [{ actionId: 'control', options: { action: 'pause' } }],
					up: [],
				},
			],
			feedbacks: [],
		}

		presets['stop_timer'] = {
			type: 'button',
			category: 'Timer Control',
			name: 'Stop Timer',
			style: {
				text: 'STOP',
				size: '18',
				color: foregroundColor,
				bgcolor: combineRgb(204, 0, 0),
			},
			steps: [
				{
					down: [{ actionId: 'control', options: { action: 'stop' } }],
					up: [],
				},
			],
			feedbacks: [],
		}

		const set_times = [60, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3300, 3600, 3900, 4200, 4500, 4800, 5100, 5400, 5700, 6000, 6300, 6600, 6900, 7200]
		for (const time of set_times) {
			const h = Math.floor(time / 3600)
			const m = Math.floor((time % 3600) / 60)
			const s = time % 60
			const time_hms = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
			const name = `${h > 0 ? `${h}h` : ''}${m > 0 ? `${m}m` : ''}${s > 0 ? `${s}s` : ''}`

			presets[`set_${time}s`] = {
				type: 'button',
				category: 'Set Timer',
				name: `Set timer to ${name}`,
				style: {
					text: `${name}`,
					size: '18',
					color: foregroundColor,
					bgcolor: backgroundColor,
				},
				steps: [
					{
						down: [{ actionId: 'set_timer', options: { time: time_hms } }],
						up: [],
					},
				],
				feedbacks: [
					{
						feedbackId: 'selected_time',
						options: {
							time: time,
						},
						style: {
							bgcolor: combineRgb(0, 0, 255), // Blue
						}
					},
				],
			}
		}
		
		presets['add_minute'] = {
			type: 'button',
			category: 'Adjust Time',
			name: 'Add 1 Minute',
			style: {
				text: '+1 MIN',
				size: '18',
				color: foregroundColor,
				bgcolor: backgroundColor,
			},
			steps: [
				{
					down: [{ actionId: 'add_time', options: { time: '00:01:00' } }],
					up: [],
				},
			],
			feedbacks: [],
		}

		presets['subtract_minute'] = {
			type: 'button',
			category: 'Adjust Time',
			name: 'Subtract 1 Minute',
			style: {
				text: '-1 MIN',
				size: '18',
				color: foregroundColor,
				bgcolor: backgroundColor,
			},
			steps: [
				{
					down: [{ actionId: 'subtract_time', options: { time: '00:01:00' } }],
					up: [],
				},
			],
			feedbacks: [],
		}


		this.setPresetDefinitions(presets)
	}

	init_variables() {
		const variables = [
			{ variableId: 'timer_hms', name: 'Timer (HH:MM:SS)' },
			{ variableId: 'timer_hm', name: 'Timer (HH:MM)' },
			{ variableId: 'timer_ms', name: 'Timer (MM:SS)' },
			{ variableId: 'timer_s', name: 'Timer (seconds)' },
			{ variableId: 'top_aux_text', name: 'Top Aux Text' },
			{ variableId: 'bottom_aux_text', name: 'Bottom Aux Text' },
		]
		this.setVariableDefinitions(variables)
		this.update_variables()
	}

	init_webserver() {
		if (this.config.port) {
			const { server, io } = setupWebServer(this)
			this.server = server
			this.io = io
		}
	}

	getFullState() {
		return {
			remaining: this.timer_remaining,
			state: this.timer_state,
			top_aux: this.top_aux_text,
			bottom_aux: this.bottom_aux_text,
			config: {
				amber: this.config.amber_time,
				red: this.config.red_time,
				show_internal_time: this.config.show_internal_time,
				time_corner: this.config.time_corner,
				timer_fontsize: this.config.timer_fontsize,
				aux_fontsize: this.config.aux_fontsize,
			},
		}
	}

	broadcastState() {
		if (this.io) {
			this.io.emit('state', this.getFullState())
		}
	}

	update_variables() {
		const seconds = Math.abs(this.timer_remaining)
		const sign = this.timer_remaining < 0 ? '-' : ''
		const h = Math.floor(seconds / 3600)
		const m = Math.floor((seconds % 3600) / 60)
		const s = seconds % 60

		const hms = `${sign}${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
		const hm = `${sign}${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
		const ms = `${sign}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`

		this.setVariableValues({
			timer_hms: hms,
			timer_hm: hm,
			timer_ms: ms,
			timer_s: this.timer_remaining.toString(),
			top_aux_text: this.top_aux_text,
			bottom_aux_text: this.bottom_aux_text,
		})
	}

	set_timer(seconds) {
		if (this.timer_interval) {
			clearInterval(this.timer_interval)
			this.timer_interval = null
		}
		this.timer_remaining = seconds
		this.last_set_time = seconds
		this.timer_state = 'stopped'
		this.update_variables()
		this.broadcastState()
		this.checkFeedbacks('state_color', 'selected_time')
	}

	start_timer() {
		if (this.timer_state !== 'running') {
			this.timer_state = 'running'
			this.timer_interval = setInterval(() => this.tick(), 1000)
			this.broadcastState()
			this.checkFeedbacks('state_color')
		}
	}

	pause_timer() {
		if (this.timer_state === 'running') {
			this.timer_state = 'paused'
			if (this.timer_interval) {
				clearInterval(this.timer_interval)
				this.timer_interval = null
			}
			this.broadcastState()
			this.checkFeedbacks('state_color')
		}
	}

	stop_timer() {
		this.timer_state = 'stopped'
		if (this.timer_interval) {
			clearInterval(this.timer_interval)
			this.timer_interval = null
		}
		this.timer_remaining = this.last_set_time
		this.update_variables()
		this.broadcastState()
		this.checkFeedbacks('state_color')
	}

	tick() {
		if (this.timer_state === 'running') {
			if (this.timer_remaining > 0) {
				this.timer_remaining--
			} else {
				// Blinking and counting up with a minus is a display concern.
				// The core logic will just go into negative.
				this.timer_remaining--
			}
			this.update_variables()
			this.checkFeedbacks('state_color')
			this.broadcastState()
		}
	}
} 