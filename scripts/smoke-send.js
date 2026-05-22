(async ()=>{
  try{
    require('dotenv').config({path: './.env'});
    const {PrismaClient} = require('@prisma/client');
    const prisma = new PrismaClient();
    const jwt = require('jsonwebtoken');
    const fetch = global.fetch || require('node-fetch');

    const accountEmail = 'romualdndri9@gmail.com';
    const phone = '+2250574432780';

    let account = await prisma.account.findUnique({ where: { adminEmail: accountEmail } });
    if (!account) {
      account = await prisma.account.create({ data: { companyName: 'Romuald Test Co', adminEmail: accountEmail, passwordHash: 'fakehash', country: 'CIV' } });
      console.log('Created account', account.id);
    } else {
      console.log('Found account', account.id);
    }

    let contact = await prisma.contact.findFirst({ where: { accountId: account.id, OR: [{ email: accountEmail }, { phone: phone }] } });
    if (!contact) {
      contact = await prisma.contact.create({ data: { accountId: account.id, email: accountEmail, phone: phone, firstName: 'Romuald', lastName: 'Test', optOut: false } });
      console.log('Created contact', contact.id);
    } else {
      console.log('Found contact', contact.id);
    }

    let segment = await prisma.segment.findFirst({ where: { accountId: account.id, name: 'Smoke Test Segment' } });
    if (!segment) {
      segment = await prisma.segment.create({ data: { accountId: account.id, name: 'Smoke Test Segment', type: 'manual', criteria: {} } });
      console.log('Created segment', segment.id);
    } else {
      console.log('Found segment', segment.id);
    }

    const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'secret';
    const token = jwt.sign({ sub: account.id, email: account.adminEmail }, secret, { expiresIn: '8h' });
    console.log('JWT created');

    const apiBase = 'http://localhost:3000/api';

    // create email campaign
    const emailPayload = {
      channelType: 'EMAIL',
      name: 'Smoke Test Email',
      segmentId: segment.id,
      emailContent: {
        subject: '[SMOKE] Test Email',
        preheader: 'Test preheader',
        blocks: [ { id: 'blk-1', type: 'text', content: { text: "Hello Romuald — c'est un test de smoke.", fontSize: 14 } } ]
      }
    };

    let res = await fetch(apiBase + '/campaigns', { method: 'POST', body: JSON.stringify(emailPayload), headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token } });
    const createdEmail = await res.json();
    console.log('Create email campaign response', createdEmail);
    const emailId = createdEmail.id || (createdEmail.data && createdEmail.data.id);
    if (!emailId) { console.error('Failed to create email campaign'); process.exit(1); }

    res = await fetch(apiBase + `/campaigns/${emailId}/send`, { method: 'POST', body: JSON.stringify({ immediateOrScheduled: 'immediate' }), headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token } });
    const emailSend = await res.json();
    console.log('Email send response', emailSend);

    // create sms campaign
    const smsPayload = {
      channelType: 'SMS',
      name: 'Smoke Test SMS',
      segmentId: segment.id,
      smsContent: {
        message: 'Test SMS message. Reply STOP to unsubscribe.'
      }
    };

    res = await fetch(apiBase + '/campaigns', { method: 'POST', body: JSON.stringify(smsPayload), headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token } });
    const createdSms = await res.json();
    console.log('Create sms campaign response', createdSms);
    const smsId = createdSms.id || (createdSms.data && createdSms.data.id);
    if (!smsId) { console.error('Failed to create sms campaign'); process.exit(1); }

    res = await fetch(apiBase + `/campaigns/${smsId}/send`, { method: 'POST', body: JSON.stringify({ immediateOrScheduled: 'immediate' }), headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token } });
    const smsSend = await res.json();
    console.log('SMS send response',smsSend);

    console.log('Done');
    process.exit(0);
  } catch (err) {
    console.error('Script error', err);
    process.exit(1);
  }
})();
