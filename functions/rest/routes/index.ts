import { router } from '../router';
import { Env } from '../[[path]]'
import { json } from 'itty-router-extras';
import StatusCode, { Ok, Fail, Build, ImgItem, ImgList, ImgReq, Folder, AuthToken, FailCode, NotAuth } from "../type";
import { checkFileType, getFilePath, parseRange } from '../utils'
import { R2ListOptions } from "@cloudflare/workers-types";

const auth = async (request: Request, env: Env) => {
    const method = request.method;
    // console.log(method)
    if (method == "GET" || method == "OPTIONS") {
        return
    }
    // get user token
    const token = request.headers.get('Authorization')
    if (!token) {
        return json(NotAuth())
    }
    // with kv equal
    const authKey = env.AUTH_TOKEN;
    if (!authKey) {
        return json(Fail("system not auth setting"))
    }
    if (authKey != token) {
        return json(FailCode("auth fail", StatusCode.NotAuth))
    }
    // return new Response('Not Authenticated', { status: 401 })
}

// 检测token是否有效
router.post('/checkToken', async (req: Request, env: Env) => {
    const data = await req.json() as AuthToken
    const token = data.token
    if (!token) {
        return json(Ok(false))
    }
    const authKey = env.AUTH_TOKEN;
    if (!authKey) {
        return json(Ok(false))
    }
    if (authKey != token) {
        return json(Ok(false))
    }
    return json(Ok(true))
})

// // list image
// router.post('/list', auth, async (req: Request, env: Env) => {
//     const data = await req.json() as ImgReq
//     if (!data.limit) {
//         data.limit = 10
//     }
//     if (data.limit > 100) {
//         data.limit = 100
//     }
//     if (!data.delimiter) {
//         data.delimiter = "/"
//     }
//     let include = undefined
//     if (data.delimiter != "/") {
//         include = data.delimiter
//     }
//     // console.log(include)
//     const options = <R2ListOptions>{
//         limit: data.limit,
//         cursor: data.cursor,
//         delimiter: data.delimiter,
//         prefix: include
//     }
//     const list = await env.R2.list(options)
//     // console.log(list)
//     const truncated = list.truncated ? list.truncated : false
//     const cursor = list.cursor
//     const objs = list.objects
//     const urls = objs.map(it => {
//         return <ImgItem>{
//             url: `/rest/${it.key}`,
//             copyUrl: `${env.COPY_URL}/${it.key}`,
//             key: it.key,
//             size: it.size
//         }
//     })
//     return json(Ok(<ImgList>{
//         list: urls,
//         next: truncated,
//         cursor: cursor,
//         prefixes: list.delimitedPrefixes
//     }))
// })

// list image
router.post('/list', auth, async (req: Request, env: Env) => {
    const data = await req.json() as ImgReq
    if (!data.limit) {
        data.limit = 10
    }
    if (data.limit > 100) {
        data.limit = 100
    }
    if (!data.delimiter) {
        data.delimiter = "/"
    }
    data.page = data.page || 1

    let include = undefined
    if (data.delimiter != "/") {
        include = data.delimiter
    }

    // Get total count of items
    const totalItems = await getTotalItemCount(env.R2, include)
    const totalPages = Math.ceil(totalItems / data.limit)

    // Calculate the cursor based on the requested page
    if (data.page > 1 && !data.cursor) {
        const skipItems = (data.page - 1) * data.limit
        data.cursor = await getPageCursor(env.R2, skipItems, include)
    }

    const options = <R2ListOptions>{
        limit: data.limit,
        cursor: data.cursor,
        delimiter: data.delimiter,
        prefix: include
    }
    const list = await env.R2.list(options)
    const truncated = list.truncated ? list.truncated : false
    const cursor = list.cursor
    const objs = list.objects
    const urls = objs.map(it => {
        return <ImgItem>{
            url: `/rest/${it.key}`,
            copyUrl: `${env.COPY_URL}/${it.key}`,
            key: it.key,
            size: it.size
        }
    })
    return json(Ok(<ImgList>{
        list: urls,
        next: truncated,
        cursor: cursor,
        prefixes: list.delimitedPrefixes,
        totalItems,
        currentPage: data.page,
        totalPages
    }))
})

async function getTotalItemCount(bucket: R2Bucket, prefix?: string): Promise<number> {
    let count = 0
    let cursor: string | undefined

    do {
        const list = await bucket.list({ cursor, limit: 1000, prefix })
        count += list.objects.length
        cursor = list.cursor
    } while (cursor)

    return count
}

async function getPageCursor(bucket: R2Bucket, skipItems: number, prefix?: string): Promise<string | undefined> {
    let cursor: string | undefined
    let itemsSkipped = 0

    while (itemsSkipped < skipItems) {
        const list = await bucket.list({ cursor, limit: Math.min(1000, skipItems - itemsSkipped), prefix })
        itemsSkipped += list.objects.length
        cursor = list.cursor

        if (!cursor) break // 如果没有更多项目，提前退出
    }

    return cursor
}

// batch upload file
router.post('/upload', auth, async (req: Request, env: Env) => {
    const files = await req.formData()
    const images = files.getAll("files")
    const errs = []
    const urls = Array<ImgItem>()
    for (let item of images) {
        const fileType = item.type
        if (!checkFileType(fileType)) {
            errs.push(`${fileType} not support.`)
            continue
        }
        const time = new Date().getTime()
        const objecPath = await getFilePath(fileType, time)
        const header = new Headers()
        header.set("content-type", fileType)
        header.set("content-length", `${item.size}`)
        const object = await env.R2.put(objecPath, item.stream(), {
            httpMetadata: header,
        }) as R2Object
        if (object || object.key) {
            urls.push({
                key: object.key,
                size: object.size,
                copyUrl: `${env.COPY_URL}/${object.key}`,
                url: `/rest/${object.key}`,
                filename: item.name
            })
        }
    }
    return json(Build(urls, errs.toString()))
})

// 创建目录
router.post("/folder", auth, async (req: Request, env: Env) => {
    try {
        const data = await req.json() as Folder
        const regx = /^[A-Za-z_]+$/
        if (!regx.test(data.name)) {
            return json(Fail("Folder name error"))
        }
        await env.R2.put(data.name + '/', null)
        return json(Ok("Success"))
    } catch (e) {
        return json(Fail("Create folder fail"))
    }
})

// 删除key
router.get('/del/:id+', async (req: Request, env: Env) => {
    const key = req.params.id
    if (!key) {
        return json(Fail("not delete key"))
    }
    try {
        await env.R2.delete(key)
    } catch (e) {
        console.log(`img delete error:${e.message}`,)
    }
    return json(Ok(key))
})

// delete image
router.delete("/", auth, async (req: Request, env: Env) => {
    const params = await req.json()
    // console.log(params)
    const keys = params.keys;
    if (!keys || keys.length < 1) {
        return json(Fail("not delete keys"))
    }
    const arr = keys.split(',')
    try {
        for (let it of arr) {
            if (it && it.length) {
                await env.R2.delete(it)
            }
        }
    } catch (e) {
        console.log(`img delete error:${e.message}`,)
    }
    return json(Ok(keys))
})

// image detail
router.get("/:id+", async (req: Request, env: Env) => {
    let id = req.params.id
    const range = parseRange(req.headers.get('range'))
    const object = await env.R2.get(id, {
        range,
        onlyIf: req.headers,
    })
    if (object == null) {
        return json(Fail("object not found"))
    }
    const headers = new Headers()
    object.writeHttpMetadata(headers)
    headers.set('etag', object.httpEtag)
    if (range) {
        headers.set("content-range", `bytes ${range.offset}-${range.end}/${object.size}`)
    }
    const status = object.body ? (range ? 206 : 200) : 304
    return new Response(object.body, {
        headers,
        status
    })
})
