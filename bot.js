/**
 * Bot
 *
 * Credits
 * CreaturePhil - Lead Development (https://github.com/CreaturePhil)
 * TalkTakesTime - Parser (https://github.com/TalkTakesTime)
 * Stevoduhhero - Battling AI (https://github.com/stevoduhhero)
 *
 * @license MIT license
 */
const botBannedWordsDataFile = './config/botbannedwords.json';
var fs = require('fs');

if (!fs.existsSync(botBannedWordsDataFile))
	fs.writeFileSync(botBannedWordsDataFile, '{}');
	
var botBannedWords = JSON.parse(fs.readFileSync(botBannedWordsDataFile).toString());
exports.botBannedWords = botBannedWords;

function writeBotData() {
	fs.writeFileSync(botBannedWordsDataFile, JSON.stringify(botBannedWords));
}

var config = {
	name: 'Viridian Bot',
	userid: function () {
		return toId(this.name);
	},
	group: '&',
	customavatars: 'viridianbot.gif',
	rooms: ['lobby'],
	punishvals: {
		1: 'warn',
		2: 'mute',
		3: 'hourmute',
		4: 'lock',
	},
	privaterooms: ['staff'],
	hosting: {},
	laddering: true,
	ladderPercentage: 70
};

/**
 * On server start, this sets up fake user connection for bot and uses a fake ip.
 * It gets a the fake user from the users list and modifies it properties. In addition,
 * it sets up rooms that bot will join and adding the bot user to Users list and
 * removing the fake user created which already filled its purpose
 * of easily filling  in the gaps of all the user's property.
 */

function joinServer() {
	if (process.uptime() > 5) return; // to avoid running this function again when reloading
	var worker = new(require('./fake-process.js').FakeProcess)();
	Users.socketConnect(worker.server, undefined, '1', '254.254.254.254');

	for (var i in Users.users) {
		if (Users.users[i].connections[0].ip === '254.254.254.254') {

			var bot = Users.users[i];

			bot.name = config.name;
			bot.named = true;
			bot.renamePending = config.name;
			bot.authenticated = true;
			bot.userid = config.userid();
			bot.group = config.group;
			bot.avatar = config.customavatars;

			if (config.join === true) {
				Users.users[bot.userid] = bot;
				for (var room in Rooms.rooms) {
					if (room != 'global') {
						bot.roomCount[room] = 1;
						Rooms.rooms[room].users[Users.users[bot.userid]] = Users.users[bot.userid];
					}
				}
			} else {
				Users.users[bot.userid] = bot;
				for (var index in config.rooms) {
					bot.roomCount[config.rooms[index]] = 1;
					Rooms.rooms[config.rooms[index]].users[Users.users[bot.userid]] = Users.users[bot.userid];
				}
			}
			delete Users.users[i];
		}
	}
}

const ACTION_COOLDOWN = 3 * 1000;
const FLOOD_MESSAGE_NUM = 4;
const FLOOD_PER_MSG_MIN = 500; // this is the minimum time between messages for legitimate spam. It's used to determine what "flooding" is caused by lag
const FLOOD_MESSAGE_TIME = 6 * 1000;
const MIN_CAPS_LENGTH = 18;
const MIN_CAPS_PROPORTION = 0.8;

var parse = {

	chatData: {},

	processChatData: function (user, room, connection, message) {
		var isPM = false;
		if (!room || !room.users) {
			isPM = true;
			room = Rooms.rooms['lobby'];
		}
		if ((user.userid === config.userid() || !room.users[config.userid()]) && !isPM) return true;
		var botUser = Users.get(config.userid());
		if (!botUser || !botUser.connected || botUser.locked) return true;
		//this.sendReply('Leido mensaje de ' + user.name + ': ' + message);
		var cmds = this.processBotCommands(user, room, connection, message, isPM);
		if (isPM) return true;
		if (cmds) return false;

		message = message.trim().replace(/ +/g, " "); // removes extra spaces so it doesn't trigger stretching
		this.updateSeen(user.userid, 'c', room.title);
		var time = Date.now();
		if (!this.chatData[user]) this.chatData[user] = {
			zeroTol: 0,
			lastSeen: '',
			seenAt: time
		};
		if (!this.chatData[user][room]) this.chatData[user][room] = {
			times: [],
			points: 0,
			lastAction: 0
		};

		this.chatData[user][room].times.push(time);

		if (user.can('staff')) return true; //do not mod staff users

		var pointVal = 0;
		var muteMessage = '';
		
		//moderation for banned words
		for (var d in botBannedWords) {
			if (message.toLowerCase().indexOf(botBannedWords[d]) > -1) {
				if (pointVal < 4) {
					pointVal = 4;
					muteMessage = ', Su mensaje contiene una frase prohibida';
					break;
				}
			}
		}

		// moderation for flooding (more than x lines in y seconds)
		var isFlooding = (this.chatData[user][room].times.length >= FLOOD_MESSAGE_NUM && (time - this.chatData[user][room].times[this.chatData[user][room].times.length - FLOOD_MESSAGE_NUM]) < FLOOD_MESSAGE_TIME && (time - this.chatData[user][room].times[this.chatData[user][room].times.length - FLOOD_MESSAGE_NUM]) > (FLOOD_PER_MSG_MIN * FLOOD_MESSAGE_NUM));
		if (isFlooding) {
			if (pointVal < 2) {
				pointVal = 2;
				muteMessage = ', Flood';
			}
		}
		// moderation for caps (over x% of the letters in a line of y characters are capital)
		var capsMatch = message.replace(/[^A-Za-z]/g, '').match(/[A-Z]/g);
		if (capsMatch && toId(message).length > MIN_CAPS_LENGTH && (capsMatch.length >= Math.floor(toId(message).length * MIN_CAPS_PROPORTION))) {
			if (pointVal < 1) {
				pointVal = 1;
				muteMessage = ', Uso excesivo de las mayúsculas';
			}
		}
		// moderation for stretching (over x consecutive characters in the message are the same)
		//|| message.toLowerCase().match(/(..+)\1{4,}/g
		var stretchMatch = message.toLowerCase().match(/(.)\1{7,}/g); // matches the same character (or group of characters) 8 (or 5) or more times in a row
		if (stretchMatch) {
			if (pointVal < 1) {
				pointVal = 1;
				muteMessage = ', Alargar demasiado las palabras';
			}
		}
		if (pointVal > 0 && !(time - this.chatData[user][room].lastAction < ACTION_COOLDOWN)) {
			var cmd = 'mute';
			// defaults to the next punishment in config.punishVals instead of repeating the same action (so a second warn-worthy
			// offence would result in a mute instead of a warn, and the third an hourmute, etc)
			if (this.chatData[user][room].points >= pointVal && pointVal < 4) {
				this.chatData[user][room].points++;
				cmd = config.punishvals[this.chatData[user][room].points] || cmd;
			} else { // if the action hasn't been done before (is worth more points) it will be the one picked
				cmd = config.punishvals[pointVal] || cmd;
				this.chatData[user][room].points = pointVal; // next action will be one level higher than this one (in most cases)
			}
			if (config.privaterooms.indexOf(room) >= 0 && cmd === 'warn') cmd = 'mute'; // can't warn in private rooms
			// if the bot has % and not @, it will default to hourmuting as its highest level of punishment instead of roombanning
			if (this.chatData[user][room].points >= 4 && config.group === '%') cmd = 'hourmute';
			if (this.chatData[user].zeroTol > 4) { // if zero tolerance users break a rule they get an instant roomban or hourmute
				muteMessage = ', tolerancia cero';
				cmd = config.group !== '%' ? 'lock' : 'hourmute';
			}
			if (this.chatData[user][room].points >= 2) this.chatData[user].zeroTol++; // getting muted or higher increases your zero tolerance level (warns do not)
			this.chatData[user][room].lastAction = time;
			room.add('|c|' + user.group + user.name + '|' + message);
			CommandParser.parse(('/' + cmd + ' ' + user.userid + muteMessage), room, Users.get(config.name), Users.get(config.name).connections[0]);
			return false;
		}

		return true;
	},

	updateSeen: function (user, type, detail) {
		user = toId(user);
		type = toId(type);
		if (type in {j: 1, l: 1, c: 1} && (config.rooms.indexOf(toId(detail)) === -1 || config.privaterooms.indexOf(toId(detail)) > -1)) return;
		var time = Date.now();
		if (!this.chatData[user]) this.chatData[user] = {
			zeroTol: 0,
			lastSeen: '',
			seenAt: time
		};
		if (!detail) return;
		var msg = '';
		if (type in {j: 1, l: 1, c: 1}) {
			msg += (type === 'j' ? 'uniendose a la sala' : (type === 'l' ? 'abandonado la sala' : 'Chateando en')) + ' ' + detail.trim() + '.';
		} else if (type === 'n') {
			msg += 'cambiando el nick a ' + ('+%@&#~'.indexOf(detail.trim().charAt(0)) === -1 ? detail.trim() : detail.trim().substr(1)) + '.';
		}
		if (msg) {
			this.chatData[user].lastSeen = msg;
			this.chatData[user].seenAt = time;
		}
	},

	processBotCommands: function (user, room, connection, message, isPM) {
		if (room.type !== 'chat' || message.charAt(0) !== '.') return;

		var cmd = '',
			target = '',
			spaceIndex = message.indexOf(' '),
			botDelay = (Math.floor(Math.random()) * 1000),
			now = Date.now();

		if (spaceIndex > 0) {
			cmd = message.substr(1, spaceIndex - 1);
			target = message.substr(spaceIndex + 1);
		} else {
			cmd = message.substr(1);
			target = '';
		}
		cmd = cmd.toLowerCase();

		if (message.charAt(0) === '.' && Object.keys(Bot.commands).join(' ').toString().indexOf(cmd) >= 0 && message.substr(1) !== '') {

			if ((now - user.lastBotCmd) * 0.001 < 30) {
			   // connection.sendTo(room, 'Please wait ' + Math.floor((30 - (now - user.lastBotCmd) * 0.001)) + ' seconds until the next command.');
			   // return true;
			}

			user.lastBotCmd = now;
		}

		if (commands[cmd]) {
			var context = {
				sendReply: function (data) {
					if (isPM) {
						setTimeout(function () {
					   var message = '|pm|' + config.group + config.name + '|' + user.group + user.name + '|' + data;
						user.send(message);
					}, botDelay);
					} else {
						setTimeout(function () {
						room.add('|c|' + config.group + config.name + '|' + data);
					}, botDelay);
					} 
				},

				sendPm: function (data) {
					//var message = '|pm|' + config.group + config.name + '|' + user.group + user.name + '|' + data;
					//user.send(message);
					setTimeout(function () {
					   var message = '|pm|' + config.group + config.name + '|' + user.group + user.name + '|' + data;
						user.send(message);
					}, botDelay);
				},
				can: function (permission) {
					if (!user.can(permission)) {
						return false;
					}
					return true;
				},
				parse: function (target) {
					CommandParser.parse(target, room, Users.get(Bot.config.name), Users.get(Bot.config.name).connections[0]);
				},
			};

			if (typeof commands[cmd] === 'function') {
				commands[cmd].call(context, target, room, user, connection, cmd, message);
			}
		}
	},

	getTimeAgo: function (time) {
		time = Date.now() - time;
		time = Math.round(time / 1000); // rounds to nearest second
		var seconds = time % 60;
		var times = [];
		if (seconds) times.push(String(seconds) + (seconds === 1 ? ' segundo' : ' segundos'));
		var minutes, hours, days;
		if (time >= 60) {
			time = (time - seconds) / 60; // converts to minutes
			minutes = time % 60;
			if (minutes) times = [String(minutes) + (minutes === 1 ? ' minuto' : ' minutos')].concat(times);
			if (time >= 60) {
				time = (time - minutes) / 60; // converts to hours
				hours = time % 24;
				if (hours) times = [String(hours) + (hours === 1 ? ' hora' : ' horas')].concat(times);
				if (time >= 24) {
					days = (time - hours) / 24; // you can probably guess this one
					if (days) times = [String(days) + (days === 1 ? ' dia' : ' dias')].concat(times);
				}
			}
		}
		if (!times.length) times.push('0 segundos');
		return times.join(', ');
	}

};

var commands = {
	
	about: function (target, room, user) {
		if (!this.can('broadcast')) return this.sendPm('Hola, soy el Bot de Viridian. Para más información sobre mi fucionamiento escribe .guia');
		this.sendReply('Hola, soy el Bot de Viridian. Para más información sobre mi fucionamiento escribe .guia');
	},
	
	info: function (target, room, user) {
		if (!this.can('broadcast')) return this.sendPm('Hola, soy el Bot de Viridian. Para más información sobre mi fucionamiento escribe .guia');
		this.sendReply('Hola, soy el Bot de Viridian. Para más información sobre mi fucionamiento escribe .guia');
	},
	
	foro: function (target, room, user) {
		if (!this.can('broadcast')) return this.sendPm('Foro del servidor Viridian: http://viridianshowdown.hol.es/');
		this.sendReply('Foro del servidor Viridian: http://viridianshowdown.hol.es/');
	},
	
	guia: function (target, room, user) {
		if (!this.can('broadcast')) return this.sendPm('Guía sobre comandos y funcionamiento del Bot: http://pastebin.com/3Yy9MN2S');
		this.sendReply('Guía sobre comandos y funcionamiento del Bot: http://pastebin.com/3Yy9MN2S');
	},
	
	say: function (target, room, user) {
		if (!this.can('say')) return;
		this.sendReply(target);
	},
	
	hotpatch: function (target, room, user) {
		if (!this.can('hotpatch')) return;
		Bot = require('./bot.js');
		this.sendReply('Código del Bot actualizado.');
	},
	
	banword: function (target, room, user) {
		if (!this.can('rangeban')) return;
		if (!target) return;
		var word = target.toLowerCase();
		var wordId = toId(word);
		if (!wordId || wordId === '') {
			if (!botBannedWords) {
				wordId = 0;
			} else {
				wordId = Object.keys(botBannedWords).length;
			}
		}
		if (botBannedWords[wordId]) {
			this.sendPm('La frase "' + target + '" ya estaba prohibida.');
			return;
		}
		botBannedWords[toId(wordId)] = word;
		writeBotData();
		this.sendReply('La frase "' + target + '" está prohibida a partir de ahora.');
	},
	
	unbanword: function (target, room, user) {
		if (!this.can('rangeban')) return;
		if (!target) return;
		var wordId = target.toLowerCase();
		for (var d in botBannedWords) {
			if(botBannedWords[d] === wordId) {
				wordId = d;
				break;
			}
		}
		if (!botBannedWords[toId(wordId)]) {
			this.sendPm('La frase "' + target + '" no estaba prohibida.');
			return;
		}
		delete botBannedWords[toId(wordId)];
		writeBotData();
		this.sendReply('La frase "' + target + '" ha dejado de estar prohibida.');
	},
	
	vbw: function (target, room, user) {
		if (!this.can('rangeban')) return;
		var bannedWordsList = '';
		for (var d in botBannedWords) {
			bannedWordsList += botBannedWords[d] + ', ';
		}
		if (bannedWordsList === '') return this.sendPm('No hay ninguna frase prohibida.');
		this.sendPm('Frases Prohibidas en Viridian: ' + bannedWordsList);
	},

	tell: function (target, room, user) {
		if (!this.can('bottell')) return;
		var parts = target.split(',');
		if (parts.length < 2) return;
		this.parse('/tell ' + toId(parts[0]) + ', ' + Tools.escapeHTML(parts[1]));
		this.sendReply('Mensaje enviado a: ' + parts[0] + '.');
	},

	seen: function (target, room, user, connection) {
		if (!target) return;
		if (!toId(target) || toId(target).length > 18) return connection.sendTo(room, 'Invalid username.');
		if (!parse.chatData[toId(target)] || !parse.chatData[toId(target)].lastSeen) {
			return this.sendPm('El usuario ' + target.trim() + ' no ha sido visto por aquí.');
		}
		return this.sendPm(target.trim() + ' fue visto por última vez hace ' + parse.getTimeAgo(parse.chatData[toId(target)].seenAt) + ' , ' + parse.chatData[toId(target)].lastSeen);
	},

	choose: function (target, room, user, connection) {
		if (!target) return;
		target = target.replace("/", "-");
		var parts = target.split(',');
		if (parts.length < 2) return;
		var choice = parts[Math.floor(Math.random() * parts.length)];
		if (!this.can('broadcast')) return this.sendPm(choice);
		this.sendReply(' ' + choice);
	},

	helix: (function () {
		var reply = [
			"Las señales apuntan a que sí.",
			"Sí.",
			"Hay mucha niebla. Inténtalo de nuevo.",
			"Sin lugar a duda.",
			"Mis fuentes dicen que no.",
			"Tal y como lo veo, sí.",
			"Cuenta con ello.",
			"Concéntrate y pregunta de nuevo.",
			"No es buena idea.",
			"Definitivamente no.",
			"Mejor no quieras saber la respuesta.",
			"Muy dudoso.",
			"Sí - Definitivamente.",
			"Es cierto.",
			"No puedo predecir en este momento..",
			"Probablemente.",
			"No entiendo la pregunta.",
			"Mi respuesta es no.",
			"Es buena idea.",
			"No cuentes con ello."
		];

		return function (target, room, user) {
			if (!target) return;
			var message = reply[Math.floor(Math.random() * reply.length)];
			if (!this.can('broadcast')) return this.sendPm(message);
			this.sendReply(message);
		};
	})(),
	
	chiste: (function () {
		var reply = [
			"- Íbamos yo y Nacho. - No hijo, íbamos Nacho y yo. - ¿Cómo? ¿entonces yo no iba?",
			"Le dice una madre a su hijo: - ¡Me ha dicho un pajarito que te drogas! - ¡La que se droga eres tu que hablas con pajaritos!.",
			"Mi mujer me ha dejado una nota en la nevera que decía: - Me voy porque esto ya no funciona. Jo, pues si llevo dos horas revisando este cacharro y enfría de lujo.",
			"¿Cómo se llama el campeón de buceo japonés?. Tokofondo. ¿Y el subcampeón?. Kasitoko.",
			"Dos amigos: - Oye, pues mi hijo en su nuevo trabajo se siente como pez en el agua. - ¿Qué hace? - Nada...",
			"- Hola ¿te llamas google? - No, ¿por qué? - Porque tienes todo lo que busco, nena. - ¿Y tú te llamas yahoorespuestas? - No, ¿por qué? - Porque haces preguntas estúpidas...",
			"- Papá, ¿qué se siente tener un hijo tan guapo?. - No sé hijo, pregúntale a tu abuelo...",
			"Estaba una pizza llorando en el cementerio, llega otra pizza y le dice: - ¿Era familiar? - No, era mediana..",
			"- Paco ¿dónde estuviste? - En una clínica donde te quitan las ganas de fumar. - ¡Pero si estás fumando! - Ya... pero sin ganas.",
			"- ¿Bailamos? - Claro. ¿Pero quién saca a mi amiga? - Ahhh, por eso no te preocupes. ¡SEGURIDAAAAD!",
			"- ¡Señorita!¡Eh, usted, la rubia! - ¿Si, es a mi? - ¡Le comunicamos que su avión viene demorado!. - Hay qué lindo, ese es mi color favorito...",
			"Marcelo estaba trabajando, cuando su jefe va y le pregunta: - ¿Oiga, no piensa ir al velatorio de su suegra?. Y él le contesta: - No jefe, primero el trabajo, y después la diversión.",
			"- Tía Teresa, ¿para qué te pintas? - Para estar más guapa. - ¿Y tarda mucho en hacer efecto?",
			"- Te vendo un caballo. - Y yo, ¿para qué quiero un caballo vendado?.",
			"- Capitán, ¿Puedo desembarcar por la izquierda? – Se dice por babor... – Por babor Capitán, ¿Puedo desembarcar por la izquierda?",
			"- Oye, dile a tu hermana que no está gorda, que sólo es talla \"L\" fante...",
			"- Quiero decirle que estoy enamorado de su hija, y no es por el dinero. - ¿Y de cuál de las cuatro? - Ah pues.., de cualquiera.",
			"Dos amigos charlando: - ¿Y tú a quién votarás en las próximas elecciones? - Yo a Alibaba y los 40 ladrones. - ¿Y eso? - Para asegurarme de que solo sean 40.",
			"- Camarero, camarero ¿tiene ancas de rana?. - Sí. - ¡Entonces pegue un saltito y tráigame un café!.",
			"- Mi amor, estoy embarazada. ¿Qué te gustaría que fuera? - ¿Una broma?.",
			"Un codicioso estaba hablando con Dios y le pregunta:- Dios, ¿Cuánto es para ti mil años? Y Dios le contesta:- Un segundo.- ¿Y un millón de pesos?. Y Dios le contesta: - Un centavo.  Entonces el codicioso le dice: ¿Me das un un centavo?. A lo que Dios le contesta:- Espérate un segundo.",
			"Jaimito le pregunta a la maestra: Maestra, ¿usted me castigaría por algo que yo no hice? Claro que no, Jaimito. Ahh, pues que bueno, porque yo no hice mi tarea"
		];

		return function (target, room, user) {
			var message = reply[Math.floor(Math.random() * reply.length)];
			if (!this.can('broadcast')) return this.sendPm(message);
			this.sendReply(message);
		};
	})(),

	maketournament: function (target, room, user) {
		if (!this.can('maketournament')) return;
		if (Tournaments.tournaments[room.id]) return this.sendPm('Ya hay un torneo en esta Sala.');

		var parts = target.split(','),
			self = this,
			counter = 1;
		if (parts.length < 2 || Tools.getFormat(parts[0]).effectType !== 'Format' || !/[0-9]/.test(parts[1])) return this.sendPm('Correct Syntax: .maketournament [tier], [time/amount of players]');

		if (parts[1].indexOf('minute') >= 0) {
			var time = Number(parts[1].split('minute')[0]);

			this.parse('/tour create ' + parts[0] + ', elimination');
			this.sendReply('**Teneis ' + time + ' minutos' + parts[1].split('minute')[1] + ' para uniros al torneo.**');

			var loop = function () {
				setTimeout(function () {
					if (!Tournaments.tournaments[room.id]) return;
					if (counter === time) {
						if (Tournaments.tournaments[room.id].generator.users.size < 2) {
							self.parse('/tour end');
							return self.sendReply('/announce El torneo fue cancelado por falta de Jugadores.');
						}
						if (!Tournaments.tournaments[room.id].isTournamentStarted) {
						self.parse('/tour start');
						self.parse('/tour autodq 2');
						return self.sendReply('/announce El Torneo ha comenzado, suerte a todos los participantes. Si vuestro oponente no reta o acepta será descalificado en 2 minutos.');
						}
					}
					if ((time - counter) === 1) {
						self.sendReply('**Teneis ' + (time - counter) + ' minuto para uniros al torneo.**');
					} else {
						self.sendReply('**Teneis ' + (time - counter) + ' minutos para uniros al torneo.**');
					}
					counter++;
					if (!Tournaments.tournaments[room.id].isTournamentStarted) loop();
				}, 1000 * 60);
			};
			loop();
			return;
		}
		if (Number(parts[1]) < 2) return;
		parts[1] = parts[1].replace(/[^0-9 ]+/g, '');
		this.parse('/tour create ' + parts[0] + ', elimination');
		this.sendReply('**El torneo empezará cuando  ' + parts[1] + ' jugadores se unan.**');
		var playerLoop = function () {
			setTimeout(function () {
				if (!Tournaments.tournaments[room.id]) return;
				if (Tournaments.tournaments[room.id].generator.users.size === Number(parts[1])) {
					if (!Tournaments.tournaments[room.id].isTournamentStarted) {
						self.parse('/tour start');
						self.parse('/tour autodq 2');
						return self.sendReply('/announce El Torneo ha comenzado, suerte a todos los participantes. Si vuestro oponente no reta o acepta será descalificado en 2 minutos.');
					}
				}
				playerLoop();
			}, 1000 * 15);
		};
		playerLoop();
	},

	hosttournament: function (target, room, user) {
		if (!this.can('hotpatch')) return;
		if (!room) return;
		if (target.toLowerCase() === 'end' || target.toLowerCase() === 'off') {
			if (!Bot.config.hosting[room.id]) return this.sendPm('Ahora mismo no estoy haciendo torneos.');
			Bot.config.hosting[room.id] = false;
			return this.sendReply('/announce He dejado de hacer torneos automáticos para esta sala.');
		}
		if (Bot.config.hosting[room.id]) return this.sendPm('Ya estaba haciendo torneos automáticos.');

		Bot.config.hosting[room.id] = true
		this.sendReply('/announce Voy a empezar a hacer Torneos automáticos en esta sala.');

		var self = this,
			_room = room,
			_user = user;

		var poll = function () {
			if (!Bot.config.hosting[_room.id]) return;
			setTimeout(function () {
				if (tour[_room.id].question) self.parse('/endpoll');

				self.parse('/poll Formato para el siguiente Torneo, ' + Object.keys(Tools.data.Formats).filter(function (f) { return Tools.data.Formats[f].effectType === 'Format'; }).join(", "));
				setTimeout(function () {
					self.parse('/endpoll');
					Bot.commands.maketournament.call(self, (tour[_room.id].topOption + ', 2 minute'), _room, _user);
				}, 1000 * 60 * 2);
			}, 1000 * 5);
		};

		var loop = function () {
			setTimeout(function () {
				if (!Tournaments.tournaments[_room.id] && !tour[_room.id].question) poll();
				if (Bot.config.hosting[_room.id]) loop();
			}, 1000 * 60);
		};

		poll();
		loop();
	},

	join: function (target, room, user, connection) {
		if (!user.can('hotpatch')) return;
		if (!target || !Rooms.get(target.toLowerCase())) return;
		if (Rooms.get(target.toLowerCase()).users[Bot.config.name]) return this.sendPm('Ya estoy en esa sala');
		Users.get(Bot.config.name).joinRoom(Rooms.get(target.toLowerCase()));
		var botDelay = (Math.floor(Math.random() * 6) * 1000)
		setTimeout(function() {
			connection.sendTo(room, Bot.config.name + ' has joined ' +  target + ' room.');
		}, botDelay);
	},

	leave: function (target, room, user, connection) {
		if (!user.can('hotpatch')) return;
		if (!target || !Rooms.get(target.toLowerCase())) return;
		Users.get(Bot.config.name).leaveRoom(Rooms.get(target.toLowerCase()));
		var botDelay = (Math.floor(Math.random() * 6) * 1000)
		setTimeout(function() {
			connection.sendTo(room, Bot.config.name + ' has left ' +  target + ' room.');
		}, botDelay);
	},

	rpt: function (target, room, user) {
		if (!target) return;
		var options = ['roca', 'papel', 'tijeras'],
			rng = options[Math.floor(Math.random() * options.length)],
			target = toId(target);
		if (!this.can('broadcast')) {
			if (rng === target) return this.sendPm('Empate!');
			if (rng === options[0]) {
				if (target === options[1]) return this.sendPm(user.name + ' gana! Tenía ' + rng + '.');
				if (target === options[2]) return this.sendPm('Yo Gano! Tenía ' + rng + '.');
			}
			if (rng === options[1]) {
				if (target === options[2]) return this.sendPm(user.name + ' gana! Tenía ' + rng + '.');
				if (target === options[0]) return this.sendPm('Yo Gano! Tenía ' + rng + '.');
			}
			if (rng === options[2]) {
				if (target === options[0]) return this.sendPm(user.name + ' gana! Tenía ' + rng + '.');
				if (target === options[1]) return this.sendPm('Yo Gano! Tenía ' + rng + '.');
			}
		} else {
			if (rng === target) return this.sendReply('Empate!');
			if (rng === options[0]) {
				if (target === options[1]) return this.sendReply(user.name + ' gana! Tenía ' + rng + '.');
				if (target === options[2]) return this.sendReply('Yo Gano! Tenía ' + rng + '.');
			}
			if (rng === options[1]) {
				if (target === options[2]) return this.sendReply(user.name + ' gana! Tenía ' + rng + '.');
				if (target === options[0]) return this.sendReply('Yo Gano! Tenía ' + rng + '.');
			}
			if (rng === options[2]) {
				if (target === options[0]) return this.sendReply(user.name + ' gana! Tenía ' + rng + '.');
				if (target === options[1]) return this.sendReply('Yo Gano! Tenía ' + rng + '.');
			}
		}
	},

};

exports.joinServer = joinServer;
exports.config = config;
exports.parse = parse;
exports.commands = commands;

joinServer();