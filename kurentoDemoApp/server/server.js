var path = require('path');
var express = require('express');
var ws = require('ws');
var minimist = require('minimist');
var url = require('url');
var kurento = require('kurento-client');

const as_uri = "http://localhost:3030/";
const ws_uri = "ws://localhost:8888/kurento";

const record_A = 'file:///tmp/recorder_A.webm';
const record_B = 'file:///tmp/recorder_B.webm';

var app = express();

/*
 * Definition of global variables.
 */

var kurentoClient = null;
var userRegistry = new UserRegistry();
var pipelines = {};
var candidatesQueue = {};
var idCounter = 0;

function nextUniqueId() {
	idCounter++;
	return idCounter.toString();
}

/*
 * Definition of helper classes
 */

//Represents caller and callee sessions
function UserSession(id, name, socket) {
	this.id = id;
	this.name = name;
	this.socket = socket;
	this.pipeline = null;
	this.peer = null;
	this.sdpOffer = null;
}

UserSession.prototype.sendMessage = function (data) {
	this.socket.emit('message', data);
}

//Represents registrar of users
function UserRegistry() {
	this.usersById = {};
	this.usersByName = {};
}

UserRegistry.prototype.register = function (user) {
	this.usersById[user.id] = user;
	this.usersByName[user.name] = user;
}

UserRegistry.prototype.unregister = function (id) {
	var user = this.getById(id);
	if (user) delete this.usersById[id]
	if (user && this.getByName(user.name)) delete this.usersByName[user.name];
}

UserRegistry.prototype.getById = function (id) {
	return this.usersById[id];
}

UserRegistry.prototype.getByName = function (name) {
	return this.usersByName[name];
}

UserRegistry.prototype.removeById = function (id) {
	var userSession = this.usersById[id];
	if (!userSession) return;
	delete this.usersById[id];
	delete this.usersByName[userSession.name];
}

//Represents a B2B active call
function CallMediaPipeline() {
	this._pipeline = null;
	this._filter = null;
	this._webRtcEndpoint = {};
	this._recorder_A = null;
	this._recorder_B = null;
}

CallMediaPipeline.prototype.createPipeline = function (callerId, calleeId, socket, callback) {
		var self = this;
		/*getKurentoClient(function (error, kurentoClient) {
			if (error) {
				return callback(error);
			}

			kurentoClient.create('MediaPipeline', function (error, pipeline) {
				if (error) {
					return callback(error);
				}
				//for recorder caller
				pipeline.create('RecorderEndpoint', {
						uri: record_A
					},
					function (error, recorder_A) {
						if (error) return onError(error);
						//for recorder callee
						pipeline.create('RecorderEndpoint', {
								uri: record_B
							},
							function (error, recorder_B) {
								if (error) return onError(error);
								//for caller
								pipeline.create('WebRtcEndpoint', function (error, callerWebRtcEndpoint) {
									if (error) {
										pipeline.release();
										return callback(error);
									}
									//ICE
									if (candidatesQueue[callerId]) {
										while (candidatesQueue[callerId].length) {
											var candidate = candidatesQueue[callerId].shift();
											callerWebRtcEndpoint.addIceCandidate(candidate);
										}
									}
									callerWebRtcEndpoint.on('OnIceCandidate', function (event) {
										var candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
										userRegistry.getById(callerId).socket.emit('message', {
											id: 'iceCandidate',
											candidate: candidate
										});
									});
									//for callee
									pipeline.create('WebRtcEndpoint', function (error, calleeWebRtcEndpoint) {
										if (error) {
											pipeline.release();
											return callback(error);
										}
										//ICE
										if (candidatesQueue[calleeId]) {
											while (candidatesQueue[calleeId].length) {
												var candidate = candidatesQueue[calleeId].shift();
												calleeWebRtcEndpoint.addIceCandidate(candidate);
											}
										}

										calleeWebRtcEndpoint.on('OnIceCandidate', function (event) {
											var candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
											userRegistry.getById(calleeId).socket.emit('message', {
												id: 'iceCandidate',
												candidate: candidate
											});
										});
										//filter
										pipeline.create("GStreamerFilter", {
											command: 'videoflip method=4' ///'videoflip method=4'//capsfilter caps=video/x-raw,framerate=10/1,width=320,height=240
										}, function (err, filter) {
											//connect caller to callee
											callerWebRtcEndpoint.setMaxVideoSendBandwidth(5, function (err) {
												console.log(err, ' set output bitrate');
											});
											callerWebRtcEndpoint.connect(calleeWebRtcEndpoint, function (error) {
												if (error) {
													pipeline.release();
													return callback(error);
												}
												//connect caller to recorder
												callerWebRtcEndpoint.connect(recorder_A, function (err) {
													//record
													recorder_A.record(function (error) {
														if (error) return onError(error);
														console.log('recorder_A');
													});
												});
												//connect callee to caller
												calleeWebRtcEndpoint.connect(callerWebRtcEndpoint, function (error) {

													if (error) {
														pipeline.release();
														return callback(error);
													}
													calleeWebRtcEndpoint.connect(filter, function (err) {
														console.log(err);
														//connect callee to recorder
														filter.connect(calleeWebRtcEndpoint, function (err) {
															console.log(err);
															calleeWebRtcEndpoint.connect(recorder_B, function (err) {
																recorder_B.record(function (error) {
																	if (error) return onError(error);
																	console.log('recorder_A');
																});
															});
														});
													});
												});
												//save data
												self._pipeline = pipeline;
												self._webRtcEndpoint[callerId] = callerWebRtcEndpoint;
												self._webRtcEndpoint[calleeId] = calleeWebRtcEndpoint;
												self._recorder_A = recorder_A;
												self._recorder_B = recorder_B;
												callback(null);
											});
										});
									});
								});
							});
					});
			});
		})*/
		var params = {};
		getKurentoClient(function (error, kurentoClient) {
			if (error) {}
			//create pipeline
			kurentoClient.create('MediaPipeline', function (error, pipeline) {
				if (error) {}
				params.pipeline = pipeline;
				params.self = self;
				params.callback = callback;
				params.callerId = callerId;
				params.calleeId = calleeId;
				params.socket = socket;
				createRecorderA(params);
			});
		});
	}
	//Create recorder endpoint for caller
function createRecorderA(params) {
		params.pipeline.create('RecorderEndpoint', {
				uri: record_A
			},
			function (error, recorder_A) {
				if (error) {}
				params.recorder_A = recorder_A;

				createRecorderB(params);
			});
	}
	//create recorder endpoint for callee
function createRecorderB(params) {
		params.pipeline.create('RecorderEndpoint', {
				uri: record_B
			},
			function (error, recorder_B) {
				if (error) {}
				params.recorder_B = recorder_B;

				createCallerEndpoint(params);
			});
	}
	//create webRtcendpoint for caller
function createCallerEndpoint(params) {
		params.pipeline.create('WebRtcEndpoint', function (error, callerWebRtcEndpoint) {
			if (error) {}
			if (candidatesQueue[params.callerId]) {
				while (candidatesQueue[params.callerId].length) {
					var candidate = candidatesQueue[params.callerId].shift();
					callerWebRtcEndpoint.addIceCandidate(candidate);
				}
			}
			callerWebRtcEndpoint.on('OnIceCandidate', function (event) {
				var candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
				userRegistry.getById(params.callerId).socket.emit('message', {
					id: 'iceCandidate',
					candidate: candidate
				});
			});
			params.callerWebRtcEndpoint = callerWebRtcEndpoint;


			/*params.pipeline.create('FaceOverlayFilter', function (error, faceOverlayFilter) {
				faceOverlayFilter.setOverlayedImage(url.format(asUrl) + 'img/mario-wings.png', -0.35, -1.2, 1.6, 1.6, function (error) {
					params.faceOverlayFilter = faceOverlayFilter;*/
					createCalleeEndpoint(params);
				/*});
			});*/
		});
	}
	//create WebRtcEndpoint for callee
function createCalleeEndpoint(params) {
		params.pipeline.create('WebRtcEndpoint', function (error, calleeWebRtcEndpoint) {
			if (error) {}
			if (candidatesQueue[params.calleeId]) {
				while (candidatesQueue[params.calleeId].length) {
					var candidate = candidatesQueue[params.calleeId].shift();
					calleeWebRtcEndpoint.addIceCandidate(candidate);
				}
			}

			calleeWebRtcEndpoint.on('OnIceCandidate', function (event) {
				var candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
				userRegistry.getById(params.calleeId).socket.emit('message', {
					id: 'iceCandidate',
					candidate: candidate
				});
			});
			params.calleeWebRtcEndpoint = calleeWebRtcEndpoint;

			createGStreamFilter(params);
		});
	}
	//create filter for callee
function createGStreamFilter(params) {
		params.pipeline.create("GStreamerFilter", {
			command: 'alpha method=custom target-r=100 target-g=100 target-b=100 angle=10' ///'videoflip method=4'//capsfilter caps=video/x-raw,framerate=10/1,width=320,height=240
		}, function (err, filter) {
			if (err) {}
			params.filter = filter;
			initMaxSpeed(params); //for slow internet
			connectCallerToCallee(params);
		});
	}
	//set maximum speed kbps
function initMaxSpeed(params) {
		params.callerWebRtcEndpoint.setMaxVideoSendBandwidth(10, function (err) {});
		params.calleeWebRtcEndpoint.setMaxVideoSendBandwidth(10, function (err) {});
	}
	//connect caller to callee
function connectCallerToCallee(params) {
		console.log('connect caller');
		params.callerWebRtcEndpoint.connect(params.calleeWebRtcEndpoint, function (error) {
			if (error) {}
			startRecordA(params);
			connectCalleeToCaller(params);
		});
	}
	//start recording after connection
function startRecordA(params) {
		console.log('record A');
		params.callerWebRtcEndpoint.connect(params.recorder_A, function (err) {
			//record
			params.recorder_A.record(function (error) {
				if (error) {};
			});
		});
	}
	//connect callee to caller
function connectCalleeToCaller(params) {
		console.log('connect callee');
		params.calleeWebRtcEndpoint.connect(params.callerWebRtcEndpoint, function (error) {
			if (error) {}
			addFilter(params);
		});
	}
	//add filter to callee
function addFilter(params) {
		console.log('add filter');
		params.calleeWebRtcEndpoint.connect(params.filter, function (err) {
			console.log(err);
			params.filter.connect(params.calleeWebRtcEndpoint, function (err) {
				/*params.calleeWebRtcEndpoint.connect(params.faceOverlayFilter, function (error) {
					params.faceOverlayFilter.connect(params.calleeWebRtcEndpoint, function (error) {*/
						startRecordB(params);
					/*});
				});*/
			});
		});
	}
	//start recording after connection and adding filter
function startRecordB(params) {
		params.calleeWebRtcEndpoint.connect(params.recorder_B, function (err) {
			params.recorder_B.record(function (error) {
				if (error) {};
				saveData(params);
			});
		});
	}
	//save data to: stop record, delete connection etc..
function saveData(params) {
	params.self._pipeline = params.pipeline;
	params.self._webRtcEndpoint[params.callerId] = params.callerWebRtcEndpoint;
	params.self._webRtcEndpoint[params.calleeId] = params.calleeWebRtcEndpoint;
	params.self._recorder_A = params.recorder_A;
	params.self._recorder_B = params.recorder_B;
	params.callback(null);
}
CallMediaPipeline.prototype.generateSdpAnswer = function (id, sdpOffer, callback) {
	this._webRtcEndpoint[id].processOffer(sdpOffer, callback);
	this._webRtcEndpoint[id].gatherCandidates(function (error) {
		if (error) {
			return callback(error);
		}
	});
}

CallMediaPipeline.prototype.release = function () {
	if (this._pipeline) this._pipeline.release();
	this._pipeline = null;
}

/*
 * Server startup
 */

var asUrl = url.parse(as_uri);
var port = asUrl.port;
var server = app.listen(port, function () {
	console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});
var io = require('socket.io')(server);



io.on('connection', function (socket) {
	var sessionId = nextUniqueId();
	console.log('Connection received with sessionId ' + sessionId);

	socket.on('disconnect', function (data) {
		stop(socket);
	});
	socket.on('message', function (data) {
		console.log(data);
		var message = data;
		switch (message.id) {
		case 'register':
			register(sessionId, message.name, socket);
			break;

		case 'call':
			call(sessionId, message.to, message.from, message.sdpOffer);
			break;

		case 'incomingCallResponse':
			incomingCallResponse(sessionId, message.from, message.callResponse, message.sdpOffer, socket);
			break;

		case 'stop':
			stop(sessionId);
			break;

		case 'slow':
			slowConnection(message.from);
			break;
		case 'onIceCandidate':
			onIceCandidate(sessionId, message.candidate);
			break;
		case 'filter':
			releaseFilter(message.from);
			break;

		default:
			socket.emit('message', {
				id: 'error',
				message: 'Invalid message ' + message
			});
			break;
		}
	});
});

function stop(socket) {
	if (!pipelines[socket.id]) {
		return;
	}

	var pipeline = pipelines[socket.id];

	pipeline._recorder_A.stop();
	pipeline._recorder_B.stop();
	pipeline.release();

	delete pipelines[socket.id];
	pipeline.release();
	var stopperUser = userRegistry.getById(socket.id);
	var stoppedUser = userRegistry.getByName(stopperUser.peer);
	stopperUser.peer = null;
	if (stoppedUser) {
		stoppedUser.peer = null;


		delete pipelines[stoppedUser.id];
		var message = {
			id: 'stopCommunication',
			message: 'remote user hanged out'
		}
		stoppedUser.sendMessage(message)
	}
}

function incomingCallResponse(calleeId, from, callResponse, calleeSdp, socket) {

	clearCandidatesQueue(calleeId);

	function onError(callerReason, calleeReason) {
		if (pipeline) pipeline.release();
		if (caller) {
			var callerMessage = {
				id: 'callResponse',
				response: 'rejected'
			}
			if (callerReason) callerMessage.message = callerReason;
			caller.sendMessage(callerMessage);
		}

		var calleeMessage = {
			id: 'stopCommunication'
		};
		if (calleeReason) calleeMessage.message = calleeReason;
		callee.sendMessage(calleeMessage);
	}

	var callee = userRegistry.getById(calleeId);
	if (!from || !userRegistry.getByName(from)) {
		return onError(null, 'unknown from = ' + from);
	}
	var caller = userRegistry.getByName(from);

	if (callResponse === 'accept') {
		var pipeline = new CallMediaPipeline();
		pipelines[caller.id] = pipeline;
		pipelines[callee.id] = pipeline;

		pipeline.createPipeline(caller.id, callee.id, socket, function (error) {
			if (error) {
				return onError(error, error);
			}

			pipeline.generateSdpAnswer(caller.id, caller.sdpOffer, function (error, callerSdpAnswer) {
				if (error) {
					return onError(error, error);
				}

				pipeline.generateSdpAnswer(callee.id, calleeSdp, function (error, calleeSdpAnswer) {
					if (error) {
						return onError(error, error);
					}

					var message = {
						id: 'startCommunication',
						sdpAnswer: calleeSdpAnswer
					};
					callee.sendMessage(message);

					message = {
						id: 'callResponse',
						response: 'accepted',
						sdpAnswer: callerSdpAnswer
					};
					caller.sendMessage(message);
				});
			});
		});
	} else {
		var decline = {
			id: 'callResponse',
			response: 'rejected',
			message: 'user declined'
		};
		caller.sendMessage(decline);
	}
}

function call(callerId, to, from, sdpOffer) {
	clearCandidatesQueue(callerId);

	var caller = userRegistry.getById(callerId);
	var rejectCause = 'user ' + to + ' is not registered';
	if (userRegistry.getByName(to)) {
		var callee = userRegistry.getByName(to);
		caller.sdpOffer = sdpOffer
		callee.peer = from;
		caller.peer = to;
		var message = {
			id: 'incomingCall',
			from: from
		};
		return callee.sendMessage(message);
	}
	var message = {
		id: 'callResponse',
		response: 'rejected: ',
		message: rejectCause
	};
	caller.sendMessage(message);
}

function register(id, name, socket, callback) {
	function onError(error) {
		socket.emit('message', {
			id: 'registerResponse',
			response: 'rejected ',
			message: error
		});
	}

	if (!name) {
		return onError("empty user name");
	}

	if (userRegistry.getByName(name)) {
		return onError("already registered");
	}

	userRegistry.register(new UserSession(id, name, socket));
	socket.emit('message', {
		id: 'registerResponse',
		response: 'accepted'
	});
}

function releaseFilter(callerId) {
	var caller = userRegistry.getByName(callerId);
	var pipeline = pipelines[caller.id];
	//pipeline._callerWebRtcEndpoint.disconnect(pipeline._filter, function(){
	pipeline._filter.disconnect(pipeline._webRtcEndpoint[callerId]);
	//});
}

function slowConnection(callerId) {
		var caller = userRegistry.getByName(callerId);
		var pipeline = pipelines[caller.id];
		pipeline._webRtcEndpoint[caller.id].setMaxVideoSendBandwidth(10, function (err) {});
		pipeline._pipeline.create("GStreamerFilter", {
			command: 'videoflip method=4' ///'videoflip method=4'//capsfilter caps=video/x-raw,framerate=10/1,width=320,height=240
		}, function (err, filter) {
			if (err) {}
			pipeline._webRtcEndpoint[caller.id].connect(filter, function (err) {
				console.log(err);
				pipeline._filter = filter;
				filter.connect(pipeline._webRtcEndpoint[caller.id], function (err) {});
			});
		});
	}
	//Recover kurentoClient for the first time.
function getKurentoClient(callback) {
	if (kurentoClient !== null) {
		return callback(null, kurentoClient);
	}

	kurento(ws_uri, function (error, _kurentoClient) {
		if (error) {
			var message = 'Coult not find media server at address ' + ws_uri;
			return callback(message + ". Exiting with error " + error);
		}

		kurentoClient = _kurentoClient;
		callback(null, kurentoClient);
	});
}

function clearCandidatesQueue(sessionId) {
	if (candidatesQueue[sessionId]) {
		delete candidatesQueue[sessionId];
	}
}

function onIceCandidate(sessionId, _candidate) {
	var candidate = kurento.register.complexTypes.IceCandidate(_candidate);
	var user = userRegistry.getById(sessionId);

	if (pipelines[user.id] && pipelines[user.id]._webRtcEndpoint && pipelines[user.id]._webRtcEndpoint[user.id]) {
		var webRtcEndpoint = pipelines[user.id]._webRtcEndpoint[user.id];
		webRtcEndpoint.addIceCandidate(candidate);
	} else {
		if (!candidatesQueue[user.id]) {
			candidatesQueue[user.id] = [];
		}
		candidatesQueue[sessionId].push(candidate);
	}
}

app.use(express.static(path.join(__dirname, 'site')));
