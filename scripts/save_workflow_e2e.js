(async function(){
  const BASE = process.env.BASE_URL || 'http://localhost:3001/api';
  const email = `e2e_workflow_${Date.now()}@example.com`;
  const password = 'Password123!';
  console.log('Registering', email);
  const registerRes = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, motDePasse: password, nom: 'E2E Co' })
  });
  const registerJson = await registerRes.json();
  if(!registerRes.ok){ console.error('Register failed', registerJson); process.exit(1); }
  const token = registerJson.access_token || registerJson.accessToken;
  console.log('Got token:', Boolean(token));

  const createRes = await fetch(`${BASE}/automations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: 'E2E SaveWorkflow', trigger: 'contact_added', delaySeconds: 0, channel: 'Email', status: 'Active' })
  });
  const createJson = await createRes.json();
  if(!createRes.ok){ console.error('Create automation failed', createJson); process.exit(1); }
  const automationId = createJson.id || (createJson.data && createJson.data.id) || createJson.automation?.id;
  console.log('Automation created', automationId);

  const workflow = {
    nodes: [
      { id: 'n1', x: 80, y: 40, label: 'Trigger', type: 'trigger' },
      { id: 'n2', x: 80, y: 180, label: 'Wait', type: 'wait' },
      { id: 'n3', x: 80, y: 320, label: 'Action', type: 'action' }
    ],
    edges: [ { id: 'e1', from: 'n1', to: 'n2' }, { id: 'e2', from: 'n2', to: 'n3' } ]
  };

  const patchRes = await fetch(`${BASE}/automations/${automationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ workflow })
  });
  const patchJson = await patchRes.json();
  if(!patchRes.ok){ console.error('Patch failed', patchJson); process.exit(1); }
  console.log('Patch OK, automation updated id=', patchJson.id || patchJson.data?.id || automationId);

  console.log('Done');
})();
