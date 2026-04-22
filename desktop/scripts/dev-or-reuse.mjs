import { request } from 'node:http'
import { spawn } from 'node:child_process'

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4173
const EXPECTED_MARKERS = ['<title>Sales Audio AI</title>', '/src/main.tsx']

function fetchDevPage() {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: DEV_HOST,
        port: DEV_PORT,
        path: '/',
        method: 'GET',
        timeout: 1500,
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, body })
        })
      },
    )

    req.on('timeout', () => {
      req.destroy(new Error('request timeout'))
    })
    req.on('error', reject)
    req.end()
  })
}

function isExpectedDevServer(body) {
  return EXPECTED_MARKERS.every((marker) => body.includes(marker))
}

function runViteDevServer() {
  const child = spawn('pnpm', ['dev', '--host', DEV_HOST, '--port', String(DEV_PORT)], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal)
    }
  }

  process.on('SIGINT', forwardSignal)
  process.on('SIGTERM', forwardSignal)

  child.on('error', (error) => {
    console.error(`启动 Vite 开发服务器失败: ${error.message}`)
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
}

async function main() {
  try {
    const { statusCode, body } = await fetchDevPage()
    if (statusCode >= 200 && statusCode < 300 && isExpectedDevServer(body)) {
      console.log(`检测到已运行的 Vite 开发服务器，复用 http://${DEV_HOST}:${DEV_PORT}`)
      return
    }

    console.error(`端口 ${DEV_PORT} 已被占用，但不是当前项目的 Vite 开发服务器`) 
    process.exit(1)
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : undefined
    if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ETIMEDOUT') {
      runViteDevServer()
      return
    }

    console.error(`检查开发服务器失败: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

await main()
