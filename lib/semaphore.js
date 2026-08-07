class Semaphore {
    constructor(max) {
        this.max = max;
        this.active = 0;
        this.waiters = [];
    }

    async acquire() {
        if (this.active < this.max) {
            this.active++;
            return;
        }
        await new Promise(resolve => this.waiters.push(resolve));
        this.active++;
    }

    async acquireWithTimeout(timeoutMs) {
        if (this.active < this.max) {
            this.active++;
            return true;
        }
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                const index = this.waiters.indexOf(entry);
                if (index !== -1) this.waiters.splice(index, 1);
                resolve(false);
            }, timeoutMs);
            const entry = () => {
                clearTimeout(timer);
                this.active++;
                resolve(true);
            };
            this.waiters.push(entry);
        });
    }

    release() {
        if (this.waiters.length > 0) {
            const next = this.waiters.shift();
            next();
            return;
        }
        this.active--;
    }
}

module.exports = Semaphore;