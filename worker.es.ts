interface Env { }

export default {
    async fetch(request): Promise<Response> {

        /**
         * static files (404.html, sw.js, conf.js)
         */
        const ASSET_URL = 'https://hunshcn.github.io/gh-proxy/'
        // 前缀，如果自定义路由为example.com/gh/*，将PREFIX改为 '/gh/'，注意，少一个杠都会错！
        const PREFIX = '/'
        // 分支文件使用jsDelivr镜像的开关，0为关闭，默认关闭
        const Config = {
            jsdelivr: 0
        }

        const whiteList: string[] = [] // 白名单，路径里面有包含字符的才会通过，e.g. ['/username/']

        const PREFLIGHT_INIT: ResponseInit = {
            status: 204,
            headers: new Headers({
                'access-control-allow-origin': '*',
                'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
                'access-control-max-age': '1728000',
            }),
        }

        const exp1 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i
        const exp2 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i
        const exp3 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i
        const exp4 = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i
        const exp5 = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i
        const exp6 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i


        function makeRes(body: BodyInit | null, status: number = 200, headers: { [s: string]: string } = {}) {
            headers['access-control-allow-origin'] = '*'
            return new Response(body, { status, headers })
        }


        function newUrl(urlStr: string | null) {
            if (!urlStr) return null

            try {
                return new URL(urlStr)
            } catch (err) {
                return null
            }
        }


        function checkUrl(u: string | null) {
            if (!u) return false

            for (let i of [exp1, exp2, exp3, exp4, exp5, exp6]) {
                if (u.search(i) === 0) {
                    return true
                }
            }
            return false
        }


        async function fetchHandler(e: Partial<FetchEvent>) {
            const req = e.request
            const urlStr = req.url
            const urlObj = new URL(urlStr)
            let path = urlObj.searchParams.get('q')
            if (path) {
                return Response.redirect('https://' + urlObj.host + PREFIX + path, 301)
            }
            // cfworker 会把路径中的 `//` 合并成 `/`
            path = urlObj.href.substr(urlObj.origin.length + PREFIX.length).replace(/^https?:\/+/, 'https://')
            if (path.search(exp1) === 0 || path.search(exp5) === 0 || path.search(exp6) === 0 || path.search(exp3) === 0 || path.search(exp4) === 0) {
                return httpHandler(req, path)
            } else if (path.search(exp2) === 0) {
                if (Config.jsdelivr) {
                    const newUrl = path.replace('/blob/', '@').replace(/^(?:https?:\/\/)?github\.com/, 'https://cdn.jsdelivr.net/gh')
                    return Response.redirect(newUrl, 302)
                } else {
                    path = path.replace('/blob/', '/raw/')
                    return httpHandler(req, path)
                }
            } else if (path.search(exp4) === 0) {
                const newUrl = path.replace(/(?<=com\/.+?\/.+?)\/(.+?\/)/, '@$1').replace(/^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com/, 'https://cdn.jsdelivr.net/gh')
                return Response.redirect(newUrl, 302)
            } else {
                return fetch(ASSET_URL + path)
            }
        }


        function httpHandler(req: Request, pathname: string) {
            const reqHdrRaw = req.headers

            // preflight
            if (req.method === 'OPTIONS' &&
                reqHdrRaw.has('access-control-request-headers')
            ) {
                return new Response(null, PREFLIGHT_INIT)
            }

            const reqHdrNew = new Headers(reqHdrRaw)

            let urlStr = pathname
            let flag = !Boolean(whiteList.length)
            for (let i of whiteList) {
                if (urlStr.includes(i)) {
                    flag = true
                    break
                }
            }
            if (!flag) {
                return new Response("blocked", { status: 403 })
            }
            if (urlStr.search(/^https?:\/\//) !== 0) {
                urlStr = 'https://' + urlStr
            }
            const urlObj = newUrl(urlStr)

            if (!urlObj) {
                return new Response("url error", { status: 404 })
            }

            const reqInit: RequestInit = {
                method: req.method,
                headers: reqHdrNew,
                redirect: 'manual',
                body: req.body
            }
            return proxy(urlObj, reqInit)
        }


        async function proxy(urlObj: URL, reqInit: RequestInit) {
            const res = await fetch(urlObj.href, reqInit)
            const resHdrOld = res.headers
            const resHdrNew = new Headers(resHdrOld)

            const status = res.status

            if (resHdrNew.has('location')) {
                let _location = resHdrNew.get('location')
                if (checkUrl(_location))
                    resHdrNew.set('location', PREFIX + _location)
                else {
                    const newLocation = newUrl(_location)
                    if (!newLocation) return new Response("url error", { status: 404 })

                    reqInit.redirect = 'follow'
                    return proxy(newLocation, reqInit)
                }
            }
            resHdrNew.set('access-control-expose-headers', '*')
            resHdrNew.set('access-control-allow-origin', '*')

            resHdrNew.delete('content-security-policy')
            resHdrNew.delete('content-security-policy-report-only')
            resHdrNew.delete('clear-site-data')

            return new Response(res.body, {
                status,
                headers: resHdrNew,
            })
        }


        return fetchHandler({ request }).catch(err => makeRes('cfworker error:\n' + err.stack, 502))
    }
} satisfies ExportedHandler<Env>
