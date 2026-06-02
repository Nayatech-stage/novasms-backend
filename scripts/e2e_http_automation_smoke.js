(async () => {
  const base = process.env.BASE_URL || 'http://localhost:3000/api';
  const rand = Date.now();
  const email = `e2e+${rand}@example.com`;
  const password = 'Password1!';

  console.log('Registering account', email);
  const regRes = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nom: 'E2E Company',
      email,
      motDePasse: password,
      nomBoutique: 'E2E Shop',
      pays: 'FR',
    }),
  });
  const regJson = await regRes.json();
  if (!regRes.ok) {
    console.error('Register failed', regRes.status, regJson);
    process.exit(1);
  }
  const token = regJson.accessToken || regJson.access_token;
  if (!token) {
    console.error('No token returned from register', regJson);
    process.exit(1);
  }

  const authHeader = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  console.log('Creating automation');
  const createAutoRes = await fetch(`${base}/automations`, {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({
      name: 'E2E Welcome Automation',
      trigger: 'contact_added',
      delaySeconds: 0,
      channel: 'Email',
      templateId: null,
      status: 'Active',
    }),
  });
  const autoJson = await createAutoRes.json();
  if (!createAutoRes.ok) {
    console.error('Create automation failed', createAutoRes.status, autoJson);
    process.exit(1);
  }
  const automationId = autoJson.id || (autoJson.data && autoJson.data.id) || autoJson.id;
  console.log('Automation created', automationId);

  console.log('Creating contact');
  const contactRes = await fetch(`${base}/contacts`, {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({
      email: `contact+${rand}@example.com`,
      firstName: 'Jean',
      lastName: 'Tester',
    }),
  });
  const contactJson = await contactRes.json();
  if (!contactRes.ok) {
    console.error('Create contact failed', contactRes.status, contactJson);
    process.exit(1);
  }
  const contactId = contactJson.id || contactJson.data || contactJson;
  console.log('Contact created', contactId);

  console.log('Polling automation sendCount...');
  const timeout = Date.now() + 30_000; // 30s timeout
  while (Date.now() < timeout) {
    const checkRes = await fetch(`${base}/automations/${automationId}`, {
      headers: authHeader,
    });
    const checkJson = await checkRes.json();
    if (!checkRes.ok) {
      console.error('Failed to fetch automation', checkRes.status, checkJson);
      process.exit(1);
    }
    const sendCount = checkJson.sendCount ?? checkJson.send_count ?? (checkJson.data && checkJson.data.sendCount) ?? (checkJson.data && checkJson.data.send_count);
    console.log('Current sendCount:', sendCount);
    if (sendCount && Number(sendCount) > 0) {
      console.log('SUCCESS: automation executed, sendCount=', sendCount);
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error('Timeout waiting for automation execution');
  process.exit(2);
})();
