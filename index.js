const crypto = require('crypto');

function signRequestBody(key, body) {
  return `sha1=${crypto.createHmac('sha1', key).update(body, 'utf-8').digest('hex')}`;
}

exports.handler = (event, context, callback) => {
  console.log(JSON.stringify(event));
  var errMsg; // eslint-disable-line
  const token = process.env.GITHUB_WEBHOOK_SECRET;
  const headers = event.headers;
  const sig = headers['X-Hub-Signature'];
  const githubEvent = headers['X-GitHub-Event'];
  const id = headers['X-GitHub-Delivery'];
  const calculatedSig = signRequestBody(token, JSON.stringify(event.body));

  if (typeof token !== 'string') {
    errMsg = 'Must provide a \'GITHUB_WEBHOOK_SECRET\' env variable';
    return callback(null, {
      statusCode: 401,
      headers: { 'Content-Type': 'text/plain' },
      body: errMsg,
    });
  }

  if (!sig) {
    errMsg = 'No X-Hub-Signature found on request';
    return callback(null, {
      statusCode: 401,
      headers: { 'Content-Type': 'text/plain' },
      body: errMsg,
    });
  }

  if (!githubEvent) {
    errMsg = 'No X-Github-Event found on request';
    return callback(null, {
      statusCode: 422,
      headers: { 'Content-Type': 'text/plain' },
      body: errMsg,
    });
  }

  if (!id) {
    errMsg = 'No X-Github-Delivery found on request';
    return callback(null, {
      statusCode: 401,
      headers: { 'Content-Type': 'text/plain' },
      body: errMsg,
    });
  }

  if (sig !== calculatedSig) {
    errMsg = 'X-Hub-Signature incorrect. Github webhook token doesn\'t match';
    return callback(null, {
      statusCode: 401,
      headers: { 'Content-Type': 'text/plain' },
      body: errMsg,
    });
  }

  /* eslint-disable */
  console.log('---------------------------------');
  console.log(`Github-Event: "${githubEvent}" with action: "${event.body.action}"`);
  console.log('---------------------------------');
  console.log('Payload', event.body);
  /* eslint-enable */

  // Do custom stuff here with github event data
  // For more on events see https://developer.github.com/v3/activity/events/types/

  const response = {
    statusCode: 200,
  //  body: calculatedSig
    body: JSON.stringify({
      input: event,
    })
  };
  
  handleWebhook(githubEvent, event.body);

  return callback(null, response);
};

function handleWebhook(type, webhook)
{
    var body = JSON.stringify(webhook, null, 2);

    switch (type) {
    case "organization":
      return handleOrganizationEvent(type, body);
    case "public":
      return handlePublicEvent(type, body);
    case "fork":
      return handleForkEvent(type, body);
	   case "repository":
      return handleRepositoryEvent(type, body);
    default:
      return handleUnknownEvent(type, body);
    }
}

function handleUnknownEvent(type, body) {
  //var jsonobj = JSON.parse(body);
  return Promise.reject('Unhandled Event Type: '+type);
};

function handleRepositoryEvent(type, body) {
  var jsonobj = JSON.parse(body);
  const subject = `Github user ${jsonobj.sender.login} created ${jsonobj.repository.full_name}`;
  return processEvent(type, body, subject);
};

function handleForkEvent(type, body) {
  var jsonobj = JSON.parse(body);
  const subject = `Github user ${jsonobj.sender.login} forked ${jsonobj.repository.full_name} to ${jsonobj.forkee.full_name}`;
  return processEvent(type, body, subject);
};

function handlePublicEvent(type, body) {
  var jsonobj = JSON.parse(body);
  const subject = `Github user ${jsonobj.sender.login} made ${jsonobj.repository.full_name} public`;
  return processEvent(type, body, subject);
};

function handleOrganizationEvent(type, body) {
  var jsonobj = JSON.parse(body);
  if (jsonobj.action !== 'member_added' && jsonobj.action !== 'member_removed') {
    return
  }
  const action = jsonobj.action === 'member_added' ? 'joined' : 'left'
  const subject = `Github user ${jsonobj.membership.user.login} ${action} ${jsonobj.organization.login}`;
  return processEvent(type, body, subject);
};

function processEvent(type, body, subject) {
	switch (process.env['GHC_EMAIL_NOTIFY'])
	{
	case "TRUE":
	default:
		return sendEmail(type, body, subject); 
	case "FALSE":
		return updateDB(type, body, subject); 
	}
};

var Mailgun = require('mailgun').Mailgun;
var cons = require('console');
var Sequelize = require('sequelize');
require('sequelize-isunique-validator')(Sequelize);
const aws = require('aws-sdk'); 
var psswd = '';
var db = null;

const config = {
    db_username: "gm_tools_user",
    db_password: "",
    db_name: "GMQARITCGISTOOLS",
	db_host: "AWS-UQAPA6ZZ",
	db_dialect: "mssql"
	};

function decrypt(buffer) {
   const kms = new aws.KMS(
//	 {
//        accessKeyId: 'GHCtoOpenLambda', //credentials for your IAM user
//        secretAccessKey: ' arn:aws:kms:us-east-1:580050408532:key/1f5d939b-9be6-435a-b622-2c374eede505', //credentials for your IAM user
//        region: 'us-east-1'
//   }
	);
   return new Promise((resolve, reject) => {
        const params = {
            CiphertextBlob: buffer
        };
        kms.decrypt(params, (err, data) => {
            if (err) {
				console.log('Unable to decrypt IMAG DB Password:',err);
                reject(err);
            } else {
				resolve(data.Plaintext);
            }
        });
    });
}	

function updateDB(type, body, subject) {
  return new Promise((resolve, reject) => {
	  
	var jsonobj = JSON.parse(body);
	
	var date = new Date().toISOString();
	var expr = '';
	var location = '';
	var preamble ="INSERT INTO GITHUB_EVENTS ( Application, ApplicationLocation, ResourceOwner1, ResourceOwner2, ResourceName, EventTime, EventAttributes, User_ID ) VALUES (";
		
	switch (type) {
	case 'public':
		location = jsonobj.repository.owner.html_url;
		location = location.replace('https://', '');
		var i = location.indexOf("/");
		location = location.substr(0,i);
	    expr = preamble +
			     "'GitHub', "+
			     "'" + location + "', "+
				 "'" + jsonobj.repository.owner.login + "', "+
				 "'" + "', "+
				 "'" + jsonobj.repository.name + "', "+
				 "convert(datetime,'" + date + "',127), "+
				 "'eventtype:" + type + "', "+
				 "'" + jsonobj.sender.login + "' )";
		break;
	case 'repository':
		if (jsonobj.action==='created' && !jsonobj.repository.private) {
			location = jsonobj.repository.owner.html_url;
			location = location.replace('https://', '');
			var i = location.indexOf("/");
			location = location.substr(0,i);
			expr = preamble +
					 "'GitHub', "+
					 "'" + location + "', "+
					 "'" + jsonobj.repository.owner.login + "', "+
					 "'" + "', "+
					 "'" + jsonobj.repository.name + "', "+
					 "convert(datetime,'" + date + "',127), "+
					 "'eventtype:" + type + ";repotype:public', "+
					 "'" + jsonobj.sender.login + "' )";		
		}
		break;
	case 'fork':
		if (jsonobj.repository.private) {
			location = jsonobj.forkee.owner.html_url;
			location = location.replace('https://', '');
			var i = location.indexOf("/");
			location = location.substr(0,i);
			expr = preamble +
					 "'GitHub', "+
					 "'" + location + "', "+
					 "'" + jsonobj.repository.owner.login + "', "+
					 "'" + jsonobj.forkee.owner.login+"', "+
					 "'" + jsonobj.repository.name + "', "+
					 "convert(datetime,'" + date + "',127), "+
					 "'eventtype:" + type + ";usertype:"+jsonobj.forkee.owner.type+"', "+
					 "'" + jsonobj.sender.login + "' )";
		}
		break;
	default:
		expr = '';
	}

	if (expr && expr.length > 0) {
		//console.log('Type: '+type+'  Sender: '+jsonobj.sender.login+'\n'+body);
		//console.log('Query: '+expr);
		
		switch (psswd) {
		case '':
			decrypt(new Buffer(process.env.IMAG_DB_PASSWORD_KMS,'base64')).then(plaintext => 
			{ 
				psswd = plaintext.toString('utf-8'); //was 'ascii'
			});
			psswd = process.env.IMAG_DB_PASSWORD; 
			
			db = new Sequelize(config.db_name, config.db_username, psswd,
								  {host: config.db_host, dialect: config.db_dialect,
								   pool: {max: 5, min: 0, acquire: 30000, idle: 10000 },
											  operatorsAliases: false });
			break;
		default:
			break;
		}

		db.query(expr).spread(function(results, metadata)
		{
			if (metadata > 0) {
				resolve(subject);
			}
			else {
				return reject('Insert Failed');
			}
		});
	} else {
		reject('Payload Not Processed');
	}
  })
}; //updateDB

function sendEmail(type, body, subject) {
  console.log ('mailgun trigged');
  return new Promise((resolve, reject) => {
	  var jsonobj = JSON.parse(body);
	  console.log('Type: '+type+'  Sender: '+jsonobj.sender.login+'\n'+body);
	
    var mg = new Mailgun('key-621c4e8b8407c526de22753e31d8c75b');
	const sender = 'ToolsSolutionsCommunications@ca.com';
    const testRecipient = process.env['GHC_EMAIL_RECIPIENT'];
    const recipients = testRecipient ? [testRecipient] : ['Toolsadmin@ca.com'];
	
    mg.sendText(sender, recipients, subject, body, null, function(err) {
      if (err) {
        console.log(err)
        return reject(err);
      }
      resolve(subject);
    });
  })
}; //sendEmail