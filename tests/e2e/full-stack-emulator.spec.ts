import { test, expect } from '@playwright/test';

const PROJECT_ID = 'demo-khadma';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const FUNCTIONS_HOST = '127.0.0.1:5001';
const ADMIN_EMAIL = 'cherouri@gmail.com';

async function clearEmulators(): Promise<void> {
  await Promise.all([
    fetch(
      `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' }
    ),
    fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
      method: 'DELETE'
    })
  ]);
}

async function seedLaunchModerationSettings(): Promise<void> {
  // Initialize settings/marketplace with requirePreApproval: false (via Firestore Emulator REST with admin owner token)
  const res = await fetch(
    `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/settings?documentId=marketplace`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer owner'
      },
      body: JSON.stringify({
        fields: {
          requirePreApproval: { booleanValue: false },
          remoderateMaterialEdits: { booleanValue: true },
          remoderateMaterialEditsWhenEnabled: { booleanValue: true }
        }
      })
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to seed settings/marketplace: ${res.status} ${await res.text()}`);
  }
}

async function verifyLatestOobEmail(email: string): Promise<void> {
  const oobRes = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/oobCodes`);
  const oobData = (await oobRes.json()) as {
    oobCodes: Array<{ email: string; oobCode: string; requestType: string }>;
  };
  const matches = oobData.oobCodes.filter(
    (c) => c.email.toLowerCase() === email.toLowerCase() && c.requestType === 'VERIFY_EMAIL'
  );
  const latest = matches[matches.length - 1];
  if (!latest) throw new Error(`No VERIFY_EMAIL oobCode found for ${email}`);

  const applyRes = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:update?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oobCode: latest.oobCode })
    }
  );
  if (!applyRes.ok) throw new Error(`Failed to apply OOB verifyEmail: ${applyRes.status}`);
}

async function createVerifiedAuthUser(
  email: string,
  password: string
): Promise<{ uid: string; idToken: string }> {
  const signupRes = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    }
  );
  if (!signupRes.ok) throw new Error(`signUp failed: ${signupRes.status}`);
  const signup = (await signupRes.json()) as { localId: string; idToken: string };

  await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'VERIFY_EMAIL', idToken: signup.idToken })
    }
  );
  await verifyLatestOobEmail(email);

  // Sign in to obtain fresh ID token with email_verified: true
  const signinRes = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    }
  );
  if (!signinRes.ok) throw new Error(`signIn failed: ${signinRes.status}`);
  const signin = (await signinRes.json()) as { localId: string; idToken: string };
  return { uid: signin.localId, idToken: signin.idToken };
}

async function patchGigExpiresAtInEmulator(gigId: string, expiresAtIso: string): Promise<void> {
  const res = await fetch(
    `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/gigs/${gigId}?updateMask.fieldPaths=expiresAt`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer owner'
      },
      body: JSON.stringify({
        fields: {
          expiresAt: { timestampValue: expiresAtIso }
        }
      })
    }
  );
  if (!res.ok) throw new Error(`patchGigExpiresAt failed: ${res.status} ${await res.text()}`);
}

async function callCallableDirect(
  fnName: string,
  data: Record<string, unknown>,
  idToken?: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(
    `http://${FUNCTIONS_HOST}/${PROJECT_ID}/europe-west1/${fnName}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ data })
    }
  );
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

test.describe('KHADMA V1.4 — Complete Browser-to-Backend E2E (Auth + Firestore + Functions Emulators)', () => {
  test.beforeEach(async () => {
    await clearEmulators();
    await seedLaunchModerationSettings();
  });

  test('executes full Employer, Account-Free Seeker Contact, Moderation, Suspension, Monitoring & AR RTL workflows against real exported callables', async ({
    page,
    browser
  }) => {
    page.on('response', async (res) => {
      if (res.url().includes('5001') && res.status() >= 400) {
        console.error('CALLABLE_ERROR', res.url(), res.status(), await res.text().catch(() => ''));
      }
    });
    // 1. Register new email/password employer via real browser UI on /employer/post
    await page.goto('/employer/post');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Publier une offre/i);

    await page.locator('input[type="email"]').fill('patron.oran@example.dz');
    await page.locator('input[type="password"]').fill('StrongPass!2026');
    await page.getByRole('button', { name: /Créer mon compte employeur/i }).click();

    // Verify-email gate appears
    await expect(page.getByText(/Vérifiez votre adresse e-mail/i)).toBeVisible({ timeout: 15000 });

    // Complete email verification via Auth Emulator OOB code and click refresh button in UI
    await verifyLatestOobEmail('patron.oran@example.dz');
    await page.getByRole('button', { name: /J’ai vérifié mon e-mail/i }).click();

    // Posting form is now unlocked for verified email employer
    await expect(page.getByText(/Quota : 0 \/ 3/i)).toBeVisible({ timeout: 15000 });

    // 2. Publish advertisement (WhatsApp + Email) through real `manageEmployerListing` callable
    await page.getByLabel(/Titre/i).fill('Plombier bâtiment Oran');
    await page.getByLabel(/Description/i).fill('Chantier résidentiel à Es Sénia, paiement hebdomadaire.');
    const numInputs = page.locator('form input[type="number"]');
    await numInputs.nth(0).fill('3500');
    await numInputs.nth(1).fill('4500');

    // Fill WhatsApp phone & consent (WhatsApp is checked by default; also enable Email)
    await page.locator('form input[type="tel"]').fill('0550 12 34 56');
    const checkboxes = page.locator('form input[type="checkbox"]');
    // checkboxes: [0]=enableWhatsapp (checked), [1]=whatsappConsent, [2]=enableEmail
    await checkboxes.nth(1).check();
    await checkboxes.nth(2).check();
    await page.locator('form input[type="email"]').fill('recrutement@oran-plomb.dz');
    // checkbox [3]=emailConsent appears once enableEmail is checked
    await page.locator('form input[type="checkbox"]').nth(3).check();

    await page.locator('form button[type="submit"]').click();

    // Redirects to /gig/:id after real manageEmployerListing callable succeeds
    await page.waitForURL(/\/gig\/[A-Za-z0-9_-]+/, { timeout: 20000 });
    const gigUrl = page.url();
    const gigId = gigUrl.split('/gig/')[1]!;
    expect(gigId.length).toBeGreaterThan(3);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Plombier bâtiment Oran');

    // 3. Account-free job seeker opens gig in a fresh unauthenticated context & retrieves BOTH contact links via real `getGigContactLink`
    const seekerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const seekerPage = await seekerContext.newPage();
    let interceptedWaUrl = '';
    await seekerPage.route('https://wa.me/**', async (route) => {
      interceptedWaUrl = route.request().url();
      await route.abort();
    });
    await seekerPage.goto(gigUrl);
    await expect(seekerPage.getByRole('button', { name: /Contacter sur WhatsApp/i })).toBeVisible({
      timeout: 15000
    });
    const [waResp] = await Promise.all([
      seekerPage.waitForResponse(
        (r) => r.url().includes('getGigContactLink') && r.request().method() === 'POST',
        { timeout: 15000 }
      ),
      seekerPage.getByRole('button', { name: /Contacter sur WhatsApp/i }).click()
    ]);
    expect(waResp.status()).toBe(200);
    await expect.poll(() => interceptedWaUrl, { timeout: 10000 }).toContain(
      'https://wa.me/213550123456'
    );

    // Also verify real `getGigContactLink` for email channel directly via Functions Emulator
    const emailContactRes = await callCallableDirect('getGigContactLink', {
      gigId,
      channel: 'email',
      lang: 'fr'
    });
    expect(emailContactRes.status).toBe(200);
    expect(JSON.stringify(emailContactRes.body)).toContain('mailto:recrutement@oran-plomb.dz');
    await seekerContext.close();

    // 4. Employer dashboard: verify quota 1/3, archive, and republish via real UI + callable
    await page.goto('/employer');
    await expect(page.getByText(/1 \/ 3/)).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /^Archiver$/i }).click();
    await expect(page.getByText(/0 \/ 3/)).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /^Republier$/i }).click();
    await expect(page.getByText(/1 \/ 3/)).toBeVisible({ timeout: 15000 });

    // 5. Switch to Arabic RTL on mobile and verify RTL direction + localized employer dashboard
    await page.getByRole('button', { name: 'العربية' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await page.getByRole('button', { name: 'FR' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    // Sign out employer and wait for signed-out state before admin workflow
    await page.getByRole('button', { name: /Se déconnecter/i }).click();
    await expect(page.getByText(/Connectez-vous avec votre adresse e-mail vérifiée/i)).toBeVisible({
      timeout: 15000
    });

    // 6. Admin workflow: create verified admin in Auth Emulator, sign in via /admin UI,
    // verify Monitoring tab links, toggle mandatory pre-approval ON via real `adminManageMarketplace` callable
    await createVerifiedAuthUser(ADMIN_EMAIL, 'AdminStrong!2026');
    page.on('dialog', (dialog) => void dialog.accept('E2E moderation verification'));
    await page.goto('/admin');
    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill('AdminStrong!2026');
    await page.getByRole('button', { name: /Se connecter/i }).click();

    await expect(page.getByText(/Approbation préalable obligatoire/i)).toBeVisible({
      timeout: 15000
    });

    // Verify Admin Operational Monitoring tab renders all 7 live project-scoped console links + budget thresholds
    const monitoringTab = page.getByRole('button', { name: /Monitoring/i });
    await monitoringTab.scrollIntoViewIfNeeded({ timeout: 10000 });
    await monitoringTab.click({ timeout: 10000 });
    await expect(page.getByText(/5 \$ \/ 15 \$ \/ 30 \$/i)).toBeVisible({ timeout: 10000 });
    await expect(page.locator('a[href*="demo-khadma"]')).toHaveCount(7);

    // Toggle mandatory pre-approval ON via real `adminManageMarketplace` callable
    const toggleBtn = page.getByRole('button', { name: /Activer la pré-modération/i });
    await toggleBtn.scrollIntoViewIfNeeded({ timeout: 10000 });
    await toggleBtn.click({ timeout: 10000 });
    await expect(page.getByText(/Activée \(nouvelles annonces en attente\)/i)).toBeVisible({
      timeout: 15000
    });
  });

  test('verifies edit, contact consent revocation, 3-ad quota enforcement, and final-7-day renewal via real callables and browser UI', async ({
    page
  }) => {
    const emp = await createVerifiedAuthUser('lifecycle.emp@oran.dz', 'StrongPass!2026');

    // 1. Create ad #1 with WhatsApp + Email via real manageEmployerListing callable
    const create1 = await callCallableDirect(
      'manageEmployerListing',
      {
        action: 'create',
        title: 'Menuisier aluminium — Gambetta',
        description: 'Atelier menuiserie aluminium à Gambetta, Oran.',
        category: 'construction',
        listingType: 'job',
        payMin: 3000,
        payMax: 4500,
        neighborhood: 'Gambetta',
        city: 'oran',
        wilayaCode: '31',
        contactMethods: ['whatsapp', 'email'],
        contactPhone: '0552 11 22 33',
        whatsappConsent: true,
        contactEmail: 'atelier@gambetta-oran.dz',
        emailConsent: true
      },
      emp.idToken
    );
    expect(create1.status).toBe(200);
    const gig1Id = (create1.body.result as { gigId: string }).gigId;

    // 2. Sign in as employer in browser and edit ad #1 via real /employer/edit/:id UI
    await page.goto('/employer');
    await page.getByRole('tab', { name: /Se connecter/i }).click();
    await page.locator('input[type="email"]').fill('lifecycle.emp@oran.dz');
    await page.locator('input[type="password"]').fill('StrongPass!2026');
    await page.getByRole('button', { name: /Se connecter/i }).click();
    await expect(page.getByText('Menuisier aluminium — Gambetta')).toBeVisible({ timeout: 15000 });

    await page.getByRole('link', { name: /^Modifier$/i }).click();
    await page.waitForURL(/\/employer\/edit\//, { timeout: 15000 });
    await page.getByLabel(/Titre/i).fill('Chef Menuisier — Gambetta');
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL(/\/employer$/, { timeout: 15000 });
    await expect(page.getByText('Chef Menuisier — Gambetta')).toBeVisible({ timeout: 15000 });

    // 3. Revoke email consent via real `updateContact` callable -> email contact immediately rejected; WhatsApp still works
    const revokeRes = await callCallableDirect(
      'manageEmployerListing',
      {
        action: 'updateContact',
        gigId: gig1Id,
        contactMethods: ['whatsapp'],
        contactPhone: '0552 11 22 33',
        whatsappConsent: true
      },
      emp.idToken
    );
    expect(revokeRes.status).toBe(200);

    const revokedEmail = await callCallableDirect('getGigContactLink', {
      gigId: gig1Id,
      channel: 'email',
      lang: 'fr'
    });
    expect(revokedEmail.status).toBe(404);

    const activeWa = await callCallableDirect('getGigContactLink', {
      gigId: gig1Id,
      channel: 'whatsapp',
      lang: 'fr'
    });
    expect(activeWa.status).toBe(200);
    expect(JSON.stringify(activeWa.body)).toContain('https://wa.me/213552112233');

    // 4. Create ads #2 and #3 (reaches 3/3 quota), confirm 4th is rejected with 429 RESOURCE_EXHAUSTED
    for (let i = 2; i <= 3; i++) {
      const c = await callCallableDirect(
        'manageEmployerListing',
        {
          action: 'create',
          title: `Poste Quota ${i} — Oran`,
          description: 'Description valide pour test de quota.',
          category: 'delivery',
          listingType: 'job',
          payMin: 2500,
          payMax: 3500,
          neighborhood: 'Es Sénia',
          city: 'oran',
          wilayaCode: '31',
          contactMethods: ['whatsapp'],
          contactPhone: '0552 11 22 33',
          whatsappConsent: true
        },
        emp.idToken
      );
      expect(c.status).toBe(200);
    }
    const blocked4th = await callCallableDirect(
      'manageEmployerListing',
      {
        action: 'create',
        title: 'Poste Quota 4 Bloqué',
        description: 'Doit être rejeté par le quota serveur.',
        category: 'delivery',
        listingType: 'job',
        payMin: 2500,
        payMax: 3500,
        neighborhood: 'Es Sénia',
        city: 'oran',
        wilayaCode: '31',
        contactMethods: ['whatsapp'],
        contactPhone: '0552 11 22 33',
        whatsappConsent: true
      },
      emp.idToken
    );
    expect(blocked4th.status).toBe(429);

    // 5. Renewal eligibility: premature renew rejected (400 FAILED_PRECONDITION);
    // inside final 7 days -> browser `Renouveler (+30 j)` button succeeds via real callable!
    const earlyRenew = await callCallableDirect(
      'manageEmployerListing',
      { action: 'renew', gigId: gig1Id },
      emp.idToken
    );
    expect(earlyRenew.status).toBe(400);

    const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    await patchGigExpiresAtInEmulator(gig1Id, threeDaysFromNow);
    await page.reload();
    await expect(page.getByText(/3 \/ 3/)).toBeVisible({ timeout: 15000 });
    const renewBtn = page.getByRole('button', { name: /Renouveler/i });
    await expect(renewBtn).toBeVisible({ timeout: 15000 });
    await renewBtn.click();
    // After renewing (+30d), renewal button disappears because ad is no longer in the final 7 days!
    await expect(renewBtn).toHaveCount(0, { timeout: 15000 });
  });

  test('verifies moderation ON pending queue, admin approval, employer suspension, blocked contact/publishing, and reinstatement', async ({
    page,
    browser
  }) => {
    const admin = await createVerifiedAuthUser(ADMIN_EMAIL, 'AdminStrong!2026');
    const emp = await createVerifiedAuthUser('moderated.emp@oran.dz', 'StrongPass!2026');

    // 1. Admin enables mandatory pre-approval ON
    const modOn = await callCallableDirect(
      'adminManageMarketplace',
      {
        action: 'updateModerationSettings',
        requirePreApproval: true,
        remoderateMaterialEdits: true,
        reason: 'Enable moderation for E2E'
      },
      admin.idToken
    );
    expect(modOn.status).toBe(200);

    // 2. Employer submits new ad -> enters `pending` (not publicly visible or contactable)
    const pendingCreate = await callCallableDirect(
      'manageEmployerListing',
      {
        action: 'create',
        title: 'Comptable Junior — Canastel',
        description: 'Cabinet comptable à Canastel recherche comptable.',
        category: 'digital',
        listingType: 'job',
        payMin: 4000,
        payMax: 6000,
        neighborhood: 'Canastel',
        city: 'oran',
        wilayaCode: '31',
        contactMethods: ['whatsapp'],
        contactPhone: '0553 44 55 66',
        whatsappConsent: true
      },
      emp.idToken
    );
    expect(pendingCreate.status).toBe(200);
    const pendingResult = pendingCreate.body.result as { gigId: string; status: string };
    expect(pendingResult.status).toBe('pending');

    // Pending ad contact is strictly blocked for unauthenticated seekers
    const pendingContact = await callCallableDirect('getGigContactLink', {
      gigId: pendingResult.gigId,
      channel: 'whatsapp',
      lang: 'fr'
    });
    expect(pendingContact.status).toBe(404);

    // Pending ad does NOT appear on public /jobs page
    await page.goto('/jobs');
    await expect(page.getByText('Comptable Junior — Canastel')).toHaveCount(0);

    // 3. Admin signs in to /admin, sees pending ad in `En attente` tab, and approves it via real UI
    page.on('dialog', (dialog) => void dialog.accept('Suspension policy E2E test'));
    await page.goto('/admin');
    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill('AdminStrong!2026');
    await page.getByRole('button', { name: /Se connecter/i }).click();
    await expect(page.getByText('Comptable Junior — Canastel')).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: /Réapprouver/i }).click();
    await expect(page.getByText('Comptable Junior — Canastel')).toHaveCount(0, { timeout: 15000 });

    // Approved ad is now contactable by unauthenticated seekers
    const approvedContact = await callCallableDirect('getGigContactLink', {
      gigId: pendingResult.gigId,
      channel: 'whatsapp',
      lang: 'fr'
    });
    expect(approvedContact.status).toBe(200);
    expect(JSON.stringify(approvedContact.body)).toContain('https://wa.me/213553445566');

    // 4. Admin opens `Employeurs` tab and suspends the employer via real UI
    await page.getByRole('button', { name: /^Employeurs$/i }).click();
    await expect(page.getByText('moderated.emp@oran.dz')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /^Suspendre$/i }).click();
    await expect(page.getByText(/^Suspendu$/i)).toBeVisible({ timeout: 15000 });

    // Suspended employer's ad contact is immediately blocked
    const suspendedContact = await callCallableDirect('getGigContactLink', {
      gigId: pendingResult.gigId,
      channel: 'whatsapp',
      lang: 'fr'
    });
    expect(suspendedContact.status).toBe(404);

    // Suspended employer cannot publish (both server-side 403 AND browser /employer/post UI notice)
    const blockedCreate = await callCallableDirect(
      'manageEmployerListing',
      {
        action: 'create',
        title: 'Annonce Bloquée Suspendu',
        description: 'Doit être refusée.',
        category: 'digital',
        listingType: 'job',
        payMin: 3000,
        payMax: 4000,
        neighborhood: 'Canastel',
        city: 'oran',
        wilayaCode: '31',
        contactMethods: ['whatsapp'],
        contactPhone: '0553 44 55 66',
        whatsappConsent: true
      },
      emp.idToken
    );
    expect(blockedCreate.status).toBe(403);

    const empCtx = await browser.newContext({
      baseURL: 'http://127.0.0.1:4174',
      viewport: { width: 390, height: 844 }
    });
    const empPage = await empCtx.newPage();
    await empPage.goto('/employer/post');
    await empPage.getByRole('tab', { name: /Se connecter/i }).click();
    await empPage.locator('input[type="email"]').fill('moderated.emp@oran.dz');
    await empPage.locator('input[type="password"]').fill('StrongPass!2026');
    await empPage.getByRole('button', { name: /Se connecter/i }).click();
    await expect(empPage.getByText(/Votre compte employeur est suspendu/i)).toBeVisible({
      timeout: 15000
    });
    await empCtx.close();

    // 5. Admin reinstates employer via real UI -> employer returns to `Actif`, previously hidden ad stays hidden
    await page.getByRole('button', { name: /^Réactiver$/i }).click();
    await expect(page.getByText(/^Actif$/i)).toBeVisible({ timeout: 15000 });
    const stillHiddenContact = await callCallableDirect('getGigContactLink', {
      gigId: pendingResult.gigId,
      channel: 'whatsapp',
      lang: 'fr'
    });
    expect(stillHiddenContact.status).toBe(404);
  });
});
