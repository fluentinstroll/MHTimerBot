const test = require('tape');
const sinon = require('sinon');

// Stub Logger methods to minimize crosstalk.
const { stubLogger, restoreLogger } = require('../helpers/logging');
// We need a decently realistic Message stub.
const mockMessage = require('../helpers/mock-message');
// Stub the timer helpers so we don't have to worry about tests failing due to time of day
const { stubTimerHelper, restoreTimerHelper } = require('../helpers/timers');

// Declaration of what we're testing.
/** @type {{ execute: (Message, tokens: string[] ) => Promise<import('../../src/interfaces/command-result')>}} */
let NEXT;

test('commands - NEXT', suite => {
    let logStubs;
    let timerStubs;
    suite.test('Test Suite Setup', t => {
        logStubs = stubLogger();
        timerStubs = stubTimerHelper();

        // Now that we have stubs active, we can require the test subject.
        NEXT = require('../../src/commands/next');
        t.end();
    });

    suite.test('when channel is dm - when replying - signals caller', async t => {
        t.plan(2);

        const messageStub = mockMessage({ channelType: 'dm' });
        const result = await NEXT.execute(messageStub, []);
        t.true(result.replied, 'should reply');
        t.true(messageStub.channel.send.calledOnce, 'Should use the channel send');

        sinon.reset();
    });
    suite.test('when channel is text - when replying - signals caller', async t => {
        t.plan(2);

        const messageStub = mockMessage({ channelType: 'text' });
        const result = await NEXT.execute(messageStub, []);
        t.true(result.replied, 'should reply');
        t.true(messageStub.channel.send.calledOnce, 'Should use the channel send');

        sinon.reset();
    });
    suite.test('when channel#send fails - logs error', async t => {
        t.plan(4);

        const messageStub = mockMessage({ sendStub: sinon.stub().rejects(Error('oops!')) });
        const result = await NEXT.execute(messageStub, []);
        t.strictEqual(logStubs.error.callCount, 1, 'should log error');
        const [description, err] = logStubs.error.getCall(0).args;
        t.match(description, /failed to send/, 'should indicate error source');
        t.match(err.message, /oops!/, 'should log error from Message.channel#send');
        t.true(result.botError, 'should indicate bot error');

        sinon.reset();
    });
    suite.test('when called with exactly "ronza" - returns known string', async t => {
        t.plan(2);

        const messageStub = mockMessage();
        await NEXT.execute(messageStub, ['ronza']);
        const args = messageStub.channel.send.args;
        t.match(args[0][0], /muted/, 'should be sassy');
        t.true(messageStub.channel.send.calledOnce, 'Should use the channel send');


        sinon.reset();
    });
    // At this point it'd be nice to mock up some timers to get their next occurrence
    suite.test('Restore Loggers - iam', t => {
        restoreTimerHelper(timerStubs);
        restoreLogger(logStubs);
        t.end();
    });
});
