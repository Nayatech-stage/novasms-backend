(async function(){
  const BASE = process.env.BASE_URL || 'http://localhost:3001/api';
  const email = `e2e_welcome_${Date.now()}@example.com`;
  const password = 'Password123!';
  console.log('Registering', email);
  const registerRes = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, motDePasse: password, nom: 'E2E Welcome' })
  });
  const registerJson = await registerRes.json();
  if(!registerRes.ok){ console.error('Register failed', registerJson); process.exit(1); }
  const token = registerJson.access_token || registerJson.accessToken;
  console.log('Got token:', Boolean(token));

  // create automation (welcome)
  const createRes = await fetch(`${BASE}/automations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: 'E2E Welcome', trigger: 'contact_added', delaySeconds: 0, channel: 'Email', status: 'Active' })
  });
  const createJson = await createRes.json();
  if(!createRes.ok){ console.error('Create automation failed', createJson); process.exit(1); }
  const automationId = createJson.id || (createJson.data && createJson.data.id) || createJson.automation?.id;
  console.log('Automation created', automationId);

  // create contact
  const contactEmail = `contact_${Date.now()}@example.com`;
  const contactRes = await fetch(`${BASE}/contacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ email: contactEmail, firstName: 'E2E', lastName: 'Contact', phone: '+33000000000' })
  });
  const contactJson = await contactRes.json();
  if(!contactRes.ok){ console.error('Create contact failed', contactJson); process.exit(1); }
  const contactId = contactJson.id || contactJson.data?.id;
  console.log('Contact created', contactId, contactEmail);

  // poll automation sendCount
  const timeout = Date.now() + 30_000;
  while(Date.now() < timeout){
    await new Promise((r) => setTimeout(r, 1000));
    const res = await fetch(`${BASE}/automations/${automationId}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await res.json();
    const sendCount = j.sendCount ?? j.send_count ?? (j._count && j._count.executions) ?? 0;
    console.log('sendCount=', sendCount);
    if(sendCount > 0){
      console.log('SUCCESS: welcome automation executed, sendCount=', sendCount);
      process.exit(0);
    }
  }

  console.error('FAIL: sendCount did not increment within timeout');
  process.exit(1);
})();
