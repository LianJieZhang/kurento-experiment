var videoInput;
var videoOutput;
var webRtcPeer;
var myName;
var from;
var socket = io('http://192.168.1.3:3030/');
var l = 0;
var mediaConstraints =
{
	audio : true,
	video :
	{
		mandatory :
		{
			maxWidth : 640,
			minWidth : 480,
			maxFrameRate : 10,
			minFrameRate : 10
		}
	}
};
$(document).ready(function () {
	videoInput = document.getElementById('videoInput');
	$('#videoContainer').hide();

	//handle event
	$('#register').on('click', function () {
		register();
	});
	$('#call').on('click', function () {
		call();
	});
	$('#stop').on('click', function () {
		slow();
	});
	$('#nstop').on('click', function () {
		nslow();
	});
});

socket.on('message', function (data) {
	console.info('Received message: ' + data);

	switch (data.id) {
	case 'registerResponse':
		resgisterResponse(data);
		break;
	case 'callResponse':
		callResponse(data);
		break;
	case 'incomingCall':
		incomingCall(data);
		break;
	case 'startCommunication':
		startCommunication(data);
		break;
	case 'iceCandidate':
		webRtcPeer.addIceCandidate(data.candidate)
		break;
	case 'stopCommunication':
		console.info("Communication ended by remote peer");
		stop(true);
		break;
	default:
		console.error('Unrecognized message', data);
	}
});

function slow() {
	var message = {
		id: 'slow',
		from: myName
	};
	sendMessage(message);
}

function nslow() {
		var message = {
			id: 'filter',
			from: myName
		};
		sendMessage(message);
	}
	//send register message to server
function register() {
		var name = $('#name').val();
		if (name == '') {
			window.alert("You must insert your user name");
			return;
		}
		myName = name;
		var message = {
			id: 'register',
			name: name
		};
		sendMessage(message);
	}
	//response on register request
function resgisterResponse(message) {
		if (message.response == 'accepted') {
			//registration is accepted by server
			$('#videoContainer').show();
			$('#registerContainer').hide();
		} else {
			//error while register
			var errorMessage = message.message
			console.log(errorMessage);
		}
	}
	//send data to server
function sendMessage(message) {
		console.log(message);
		socket.emit('message', message);
	}
	//make a call
function call() {
	l++;
	if ($('#callName').val() == '') {
		console.log("You must type name");
		return;
	}
	var videoOutput = document.getElementById('videoOutput' + l);
	var options = {
		localVideo: videoInput,
		remoteVideo: videoOutput,
		onicecandidate : onIceCandidate
	}
	webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options, function (
		err, offerSdp) {
		this.generateOffer(onOfferCall);
		console.log(offerSdp);
	},null,mediaConstraints);
}

function onOfferCall(error, offerSdp) {
	var message = {
		id: 'call',
		from: myName,
		to: $('#callName').val(),
		sdpOffer: offerSdp
	};
	sendMessage(message);
}

function onOfferAccept(error, offerSdp) {
	var response = {
		id: 'incomingCallResponse',
		from: from,
		callResponse: 'accept',
		sdpOffer: offerSdp
	};
	sendMessage(response);
}

//start talk
function startCommunication(message) {
	//start processing opponent sdp
	webRtcPeer.processAnswer(message.sdpAnswer);
}

function callResponse(message) {
		if (message.response != 'accepted') {
			console.info('Call not accepted by peer. Closing call');
			var errorMessage = message.message ? message.message : 'Unknown reason for call rejection.';
			console.log(errorMessage);
			stop(true);
		} else {
			webRtcPeer.processAnswer(message.sdpAnswer);
		}
	}
	//stop all
function stop(message) {
		if (webRtcPeer) {
			webRtcPeer.dispose();
			webRtcPeer = null;
			if (!message) {
				var message = {
					id: 'stop'
				}
				sendMessage(message);
			}
		}
	}
	//incoming call
function incomingCall(message) {
	l++;
	if (confirm('User ' + message.from + ' is calling you. Do you accept the call?')) {
		//if confirm, start send and recieve video
		var videoOutput = document.getElementById('videoOutput' + l);
		var options = {
			localVideo: videoInput,
			remoteVideo: videoOutput,
			onicecandidate : onIceCandidate
		}
		webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options,
			function (err, offerSdp) {
				//accept incoming call
				from = message.from;
				this.generateOffer(onOfferAccept);
			},null,mediaConstraints);
	} else {
		//decline incoming call
		var response = {
			id: 'incomingCallResponse',
			from: message.from,
			callResponse: 'reject',
			message: 'user declined'
		};
		sendMessage(response);
		stop(true);
	}
}
function onIceCandidate(candidate) {
	console.log('Local candidate' + JSON.stringify(candidate));

	var message = {
		id : 'onIceCandidate',
		candidate : candidate
	}
	sendMessage(message);
}
