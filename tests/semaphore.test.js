const test = require('node:test');
const assert = require('node:assert');

const Semaphore = require('../lib/semaphore');

test('Semaphore: limita concurrencia a max', async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;

    const task = async () => {
        await sem.acquire();
        active++;
        peak = Math.max(peak, active);
        await new Promise(r => setTimeout(r, 20));
        active--;
        sem.release();
    };

    await Promise.all(Array.from({ length: 6 }, () => task()));
    assert.ok(peak <= 2, `pico=${peak} no debe exceder 2`);
});

test('Semaphore: acquire falla con timeout', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    const ok = await sem.acquireWithTimeout(50);
    assert.strictEqual(ok, false);
    sem.release();
});

test('Semaphore: acquire triunfa tras fallo y release', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    const first = await sem.acquireWithTimeout(50);
    assert.strictEqual(first, false);
    sem.release();
    const second = await sem.acquireWithTimeout(500);
    assert.strictEqual(second, true);
    sem.release();
});