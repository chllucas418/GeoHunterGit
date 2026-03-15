import { test, expect } from '@playwright/test';

test.describe('Teacher-Student Game Flow', () => {
    let teacherContext: any;
    let studentContext: any;
    let teacherPage: any;
    let studentPage: any;
    let roomCode;

    test.beforeAll(async ({ browser }) => {
        teacherContext = await browser.newContext();
        studentContext = await browser.newContext();
        teacherPage = await teacherContext.newPage();
        studentPage = await studentContext.newPage();
    });

    test.afterAll(async () => {
        await teacherContext.close();
        await studentContext.close();
    });

    test('Full Game Cycle', async () => {
        // --- TEACHER SETUP (Register as Dev) ---
        await teacherPage.goto('/register');
        await teacherPage.fill('input[name="displayName"]', 'Teacher Bot');
        await teacherPage.fill('input[name="email"]', `teacher_${Date.now()}@test.com`);
        await teacherPage.fill('input[name="password"]', 'Password123!'); // Strong password required 
        // Trigger Dev Override
        await teacherPage.click('text=Developer Access');
        await teacherPage.fill('input[name="developerKey"]', '<REDACTED_DEV_KEY>');
        
        // Agree to terms
        await teacherPage.check('input[name="agreeToTerms"]');

        await teacherPage.click('button[type="submit"]');

        // Wait for Home (Developers are not auto-redirected to dashboard)
        await expect(teacherPage).toHaveURL("http://localhost:5173/");

        // Manual Navigate to Dashboard
        await teacherPage.goto('/teacher/dashboard');
        await expect(teacherPage).toHaveURL(/\/teacher\/dashboard/);

        // Ensure Map Set Exists (Seeded data should be there, but let's be safe)
        // If "Generate Default Set" is visible, click it.
        const generateBtn = teacherPage.locator('text=Generate Default Set');
        if (await generateBtn.isVisible()) {
            await generateBtn.click();
            await teacherPage.waitForTimeout(1000); // Wait for reload
        }

        // Create Room (Deploy Simulation)
        await teacherPage.locator('button:has-text("Deploy Simulation")').first().click();

        // Redirect to Room
        await expect(teacherPage).toHaveURL(/\/teacher\/room\/\d+/, { timeout: 15000 });

        // Set Game Mode to Time Attack immediately
        await teacherPage.locator('select').filter({ hasText: 'Standard' }).selectOption('time_attack');

        // Get Room Code
        const codeElement = teacherPage.locator('h1'); // The big code display
        await expect(codeElement).toBeVisible();
        roomCode = await codeElement.innerText();
        console.log(`Room Code: ${roomCode}`);
        expect(roomCode).toMatch(/^\d{6}$/);

        // --- STUDENT JOIN ---
        await studentPage.goto('/');
        await studentPage.click('text=Initialize'); // Register/Join
        await studentPage.fill('input[name="displayName"]', 'Test Agent');
        // Student form has class info fields now
        await studentPage.fill('input[name="classGrade"]', '2A'); // Select option? It's a select.
        // It's a select: selectOption
        await studentPage.locator('select[name="classGrade"]').selectOption('2A');

        await studentPage.fill('input[name="classNumber"]', '1');
        await studentPage.fill('input[name="email"]', `student_${Date.now()}@makopan.edu.hk`); // Needs valid domain
        await studentPage.fill('input[name="password"]', 'Password123'); // Needs checks?

        // Agree to terms
        await studentPage.check('input[name="agreeToTerms"]');

        await studentPage.click('button[type="submit"]');

        // Join Room
        await studentPage.goto('/join');
        await studentPage.fill('input[name="code"]', roomCode);
        await studentPage.click('button[type="submit"]'); // "Join Mission"
        await expect(studentPage).toHaveURL(/\/live\/\d+/);

        // Wait for Lobby
        await expect(studentPage.locator('text=Stand By')).toBeVisible();

        // Check Teacher Lobby
        await expect(teacherPage.locator(`text=Test Agent`)).toBeVisible();

        // --- START GAME ---
        await teacherPage.click('text=Start Mission');

        // Verify Transition
        await expect(teacherPage.locator('text=ROUND 1')).toBeVisible();

        // Student sees game
        // Wait for splash to disappear or just check for confirmation button
        await expect(studentPage.locator('text=CONFIRM COORDINATES')).toBeVisible({ timeout: 10000 });

        // Verify Time Attack Burn Bar is visible since we set mode to time_attack
        // The burn bar translates to a div with 'h-1.5' or something from our new feature
        // It should exist in the DOM inside live.$code.tsx
        const burnBar = studentPage.locator('.h-1\\.5.rounded-r-full');
        await expect(burnBar).toBeVisible();

        // --- STUDENT PLAY ---
        // Click Map (simulated)
        const map = studentPage.locator('.w-full.h-full').nth(1);
        // We know the map is the second column usually
        await map.click({ position: { x: 200, y: 200 } });

        // Submit
        await studentPage.click('text=CONFIRM COORDINATES');

        // Verify Waiting State
        await expect(studentPage.locator('text=LOCKED IN')).toBeVisible();

        // --- TEACHER REVEAL ---
        await teacherPage.click('text=Reveal Intel');

        // Verify Review State
        await expect(teacherPage.locator('text=Official Intel')).toBeVisible();

        // Student Results (Needs polling or socket? It polls status)
        // Polling interval is 2s.
        await expect(studentPage.locator('text=Score')).toBeVisible({ timeout: 5000 });
        await expect(studentPage.locator('text=Deviation')).toBeVisible();

        // --- NEXT ROUND ---
        // await teacherPage.click('text=Next Location');
    });
});
