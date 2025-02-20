'use strict';

const nock = require('nock');
const zlib = require('zlib');
const preq = require('../index');
const Template = require('swagger-router').Template;
const assert = require('assert');

describe('preq', function() {
    this.timeout(30000); // eslint-disable no-invalid-this

    it('throws with undefined options', () =>
        assert.throws(() => preq(), Error, 'Must throw if options not provided'));

    it('throws without URI', () =>
        assert.throws(() => preq({ method: get }), Error, 'Must throw if URI not provided'));

    it('accepts swagger-router requests', () => {
        const api = nock('https://en.wikibooks.org')
        .get('/wiki/Main_Page')
        .reply(200, '');
        const reqTpl = new Template({
            uri: 'http://{{domain}}/wiki/Main_Page',
            method: 'get'
        });
        const p = preq(reqTpl.expand({
            request: { params: { domain: 'en.wikibooks.org' }}
        })).then(res => assert.strictEqual(res.status, 200))
        .then(() => api.done()).finally(() => nock.cleanAll());
    });

    it('should retry', () => {
        const api = nock('https://en.wikipedia.org')
        .get('/wiki/Main_Page')
        .times(5)
        .reply(504, '');
        const tStart = new Date();
        return preq.get({
            // Some unreachable port
            uri: 'https://en.wikipedia.org/wiki/Main_Page',
            retries: 4
        })
        .catch((e) => {
            assert.strictEqual(e.status, 504);
            const tDelta = new Date() - tStart;
            if (tDelta < 1000) {
                throw new Error("Does not look as if this actually retried!");
            }
        })
        .then(() => api.done())
        .finally(() => nock.cleanAll());
    });

    it('should not retry 404', () => {
        const api = nock('https://en.wikipedia.org')
        .get('/wiki/Main_Page')
        .reply(404, '');
        const tStart = new Date();
        return preq.get({
            // Some unreachable port
            uri: 'https://en.wikipedia.org/wiki/Main_Page',
            retries: 4
        })
        .catch((e) => {
            assert.strictEqual(e.status, 404);
            const tDelta = new Date() - tStart;
            if (tDelta > 1000) {
                throw new Error("Looks like this was actually retried!");
            }
        })
        .then(() => api.done())
        .finally(() => nock.cleanAll());
    });

    it('should respect retry-after', () => {
        const MOCK_BODY = 'Main_Wiki_Page_HTML';
        const api = nock('https://en.wikipedia.org')
        .get('/wiki/Main_Page')
        .reply(503, '', { 'retry-after': 3 })
        .get('/wiki/Main_Page')
        .reply(200, MOCK_BODY);
        const tStart = new Date();
        return preq.get({
            // Some unreachable port
            uri: 'https://en.wikipedia.org/wiki/Main_Page',
            retries: 1
        })
        .then((res) => {
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.toString(), MOCK_BODY);
            const tDelta = new Date() - tStart;
            if (tDelta < 2500) {
                throw new Error("retry-after was not respected");
            }
        })
        .then(() => api.done())
        .finally(() => nock.cleanAll());
    });

    it('should get enwiki front page', () => {
        const MOCK_BODY = 'Main_Wiki_Page_HTML';
        const api = nock('https://en.wikipedia.org')
        .get('/wiki/Main_Page')
        .reply(200, MOCK_BODY);
        return preq.get({
            uri: 'https://en.wikipedia.org/wiki/Main_Page',
        })
        .then((res) => {
            assert.strictEqual(res.status, 200);
            assert.strictEqual(!!res.body, true);
            // Make sure content-location is not set
            assert.strictEqual(!!res.headers['content-location'], false);
            assert.strictEqual(res.body.toString(   ), MOCK_BODY);
        })
        .then(() => api.done())
        .finally(() => nock.cleanAll());
    });

    it('Should wrap 504 in HTTPrror', () => {
        const MOCK_ERR = 'TEST_ERROR';
        const api = nock('https://en.wikipedia.org')
        .get('/wiki/Main_Page')
        .replyWithError(MOCK_ERR);
        return preq.get({
            uri: 'https://en.wikipedia.org/wiki/Main_Page'
        })
        .catch((e) => {
            api.done();
            assert.strictEqual(e.constructor.name, 'HTTPError');
            assert.strictEqual(e.headers['content-type'], 'application/problem+json');
            assert.strictEqual(e.body.internalURI, 'https://en.wikipedia.org/wiki/Main_Page');
            assert.strictEqual(e.body.internalErr, MOCK_ERR);
        })
        .finally(() => nock.cleanAll());
    });


    it('Should wrap 404 in HTTPError', () => {
        const api = nock('https://en.wikipedia.org')
        .get('/wiki/Main_Page')
        .reply(404, JSON.stringify({ message: 'TEST_MESSAGE' }), {
            'content-type': 'application/problem+json'
        });
        return preq.get({
            uri: 'https://en.wikipedia.org/wiki/Main_Page'
        })
        .catch((e) => {
            api.done();
            assert.strictEqual(e.constructor.name, 'HTTPError');
            assert.strictEqual(e.headers['content-type'], 'application/problem+json');
            assert.strictEqual(e.body.message, 'TEST_MESSAGE');
            assert.strictEqual(e.body.internalURI, 'https://en.wikipedia.org/wiki/Main_Page');
        })
        .finally(() => nock.cleanAll());
    });

    it('should check for redirect', () => {
        const MOCK_BODY = 'Main_Wiki_Page_HTML';
        const api = nock('https://en.wikipedia.org')
        .get('/')
        .reply(301, undefined, { location: 'https://en.wikipedia.org/wiki/Main_Page' })
        .get('/wiki/Main_Page')
        .reply(200, MOCK_BODY);
        return preq.get({
            uri: 'https://en.wikipedia.org/'
        })
        .then((res) => {
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.headers['content-location'],
                'https://en.wikipedia.org/wiki/Main_Page');
            assert.strictEqual(res.body.toString(), MOCK_BODY);
        })
        .then(() => api.done())
        .finally(() => nock.cleanAll());
    });

    it('should support query', () => {
        const MOCK_BODY = 'Main_Wiki_Page_HTML';
        const api = nock('https://en.wikipedia.org')
        .get('/wiki/Main_Page')
        .query({ q : 'foo' })
        .reply(200, MOCK_BODY);
        return preq.get({
            uri: 'https://en.wikipedia.org/wiki/Main_Page',
            query: {
                q: 'foo'
            }
        })
        .then((res) => {
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.toString(), MOCK_BODY);
        })
        .then(() => api.done())
        .finally(() => nock.cleanAll());
    });

    it('should support simple constructor style', () => {
        const MOCK_BODY = 'Main_Wiki_Page_HTML';
        const api = nock('https://en.wikipedia.org')
        .get('/wiki/Main_Page')
        .reply(200, MOCK_BODY);
        return preq('https://en.wikipedia.org/wiki/Main_Page')
        .then((res) => {
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.toString(), MOCK_BODY);
        })
        .then(() => api.done())
        .finally(() => nock.cleanAll());
    });

    it('should support simple constructor style with query', () => {
        const MOCK_BODY = 'Main_Wiki_Page_HTML';
        const api = nock('https://en.wikipedia.org')
        .get('/wiki/Main_Page')
        .query({ q : 'foo' })
        .reply(200, MOCK_BODY);
        return preq({
            method: 'get',
            uri: 'https://en.wikipedia.org/wiki/Main_Page',
            query: {
                q: 'foo'
            }
        })
        .then((res) => {
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.toString(), MOCK_BODY);
        })
        .then(() => api.done())
        .finally(() => nock.cleanAll());
    });

    it('return buffer on user-supplied encoding', () => {
        const MOCK_BODY = 'Main_Wiki_Page_HTML';
        const api = nock('https://en.wikipedia.org')
        .get('/wiki/Main_Page')
        .reply(200, MOCK_BODY);
        return preq('https://en.wikipedia.org/wiki/Main_Page', { encoding: null })
        .then((res) => {
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.constructor.name, 'Buffer');
        })
        .then(() => api.done())
        .finally(() => nock.cleanAll());
    });

    it('no content-encoding header for gzipped responses', () => {
        const MOCK_BODY = 'Main_Wiki_Page_HTML';
        const api = nock('https://en.wikipedia.org')
        .get('/wiki/Main_Page')
        .reply(200, zlib.gzipSync(Buffer.from(MOCK_BODY)), { 'content-encoding': 'gzip' });
        return preq({
            uri: 'https://en.wikipedia.org/wiki/Main_Page',
            gzip: true
        })
        .then((res) => {
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.headers['content-encoding'], undefined);
            assert.strictEqual(res.body.toString(), MOCK_BODY);
        })
        .then(() => api.done())
        .finally(() => nock.cleanAll());
    });

    it('parse json', () => {
        const api = nock('https://en.wikipedia.org')
        .get('/wiki/Main_Page')
        .reply(200, { test: 'test' }, { 'content-type': 'application/json' });
        return preq('https://en.wikipedia.org/wiki/Main_Page')
        .then((res) => {
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.test, 'test');
        })
        .then(() => api.done())
        .finally(() => nock.cleanAll());
    });

    it('resolve relative redirects', () => {
        const MOCK_BODY = 'Main_Wiki_Page_HTML';
        const api = nock('https://en.wikipedia.org')
        .get('/')
        .reply(301, undefined, { 'location': '/wiki/Main_Page' })
        .get('/wiki/Main_Page')
        .reply(200, MOCK_BODY, { 'content-location': '/wiki/Main_Page' });
        return preq('https://en.wikipedia.org')
        .then((res) => {
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.headers['content-location'],
                'https://en.wikipedia.org/wiki/Main_Page');
            assert.strictEqual(res.body.toString(), MOCK_BODY);
        })
        .then(() => api.done())
        .finally(() => nock.cleanAll());
    });

    it('remove body for 204 requests', () => {
        const api = nock('https://en.wikipedia.org')
        .get('/wiki/Main_Page')
        .reply(204, "SOME_ERRORNEOUS_BODY");
        return preq('https://en.wikipedia.org/wiki/Main_Page')
        .then((res) => {
            assert.strictEqual(res.status, 204);
            assert.strictEqual(res.body, undefined);
        })
        .then(() => api.done())
        .finally(() => nock.cleanAll());
    });

    it('lowecase request headers', () => {
        const MOCK_BODY = 'Main_Wiki_Page_HTML';
        const api = nock('https://en.wikipedia.org', {
            reqheaders: {
                'cache-control': 'no-cache',
                'x-request-id': 'test_id'
            }
        })
        .get('/wiki/Main_Page')
        .reply(200, MOCK_BODY);
        return preq({
            uri: 'https://en.wikipedia.org/wiki/Main_Page',
            headers: {
                'Cache-Control': 'no-cache',
                'x-request-id': 'test_id'
            }
        })
        .then((res) => {
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.toString(), MOCK_BODY);
        })
        .then(() => api.done())
        .finally(() => nock.cleanAll());
    });

    it('sends JSON', () => {
        const MOCK_BODY = 'Main_Wiki_Page_HTML';
        const MOCK_REQ = { test: 'test' };
        const api = nock('https://en.wikipedia.org')
        .post('/wiki/Main_Page', JSON.stringify(MOCK_REQ))
        .reply(200, MOCK_BODY);
        return preq({
            method: 'post',
            uri: 'https://en.wikipedia.org/wiki/Main_Page',
            headers: {
                'content-type': 'application/json'
            },
            body: MOCK_REQ
        })
        .then((res) => {
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.toString(), MOCK_BODY);
        })
        .then(() => api.done())
        .finally(() => nock.cleanAll());
    });

    it('sends form', () => {
        const MOCK_BODY = 'Main_Wiki_Page_HTML';
        const MOCK_REQ = { test: 'test' };
        const api = nock('https://en.wikipedia.org')
        .post('/wiki/Main_Page', 'test=test')
        .reply(200, MOCK_BODY);
        return preq({
            method: 'post',
            uri: 'https://en.wikipedia.org/wiki/Main_Page',
            body: MOCK_REQ
        })
        .then((res) => {
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.toString(), MOCK_BODY);
        })
        .then(() => api.done())
        .finally(() => nock.cleanAll());
    });

    it('request some real content, no nock', () => preq('https://en.wikipedia.org/wiki/Main_Page')
    .then((res) => {
        assert.strictEqual(res.status, 200);
        assert.strictEqual(!!res.body, true);
    }));

    it('timeout with connect timeout', () => preq({
        uri: 'http://localhost:12345',
        connectTimeout: 1
    })
    .catch(e => assert.strictEqual(e.status, 504)));
});

