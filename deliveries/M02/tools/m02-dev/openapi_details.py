"""Documentation-only enrichment for the unchanged ten M02 business routes."""
from copy import deepcopy
from datetime import date, timedelta


def enrich(doc):
    schemas = doc['components']['schemas']
    paths = doc['paths']
    doc['info']['description'] += (
        '\n所有业务请求携带 X-Client-Platform: h5；写请求携带 CSRF，POST 使用 UUID v4 幂等键。'
        '\n示例全部为文档构造数据，不代表数据库中的用户或记录。示例日期为 2026-10-20，实际调用按服务端上海业务日计算。'
        '\n正式 Cookie 名称和 CSRF 获取流程待 M01 统一确认；本地测试会话只用于显式开发配置。'
    )
    doc['externalDocs'] = {
        'description': 'M02 请求、响应、错误处理及公共底座接入说明',
        'url': 'https://github.com/Mat11-oo/qingyang-health-m02/blob/main/docs/M02/API_GUIDE.md',
    }
    doc['components']['securitySchemes']['cookieAuth']['description'] = (
        'M01 统一登录会话；session 仅为待 M01 确认的 Cookie 名称占位，不是已交付的正式登录约定。'
        '本地联调使用 m02_test_session；创建/获取测试会话见 API_GUIDE.md，不能用于生产。'
    )
    doc['x-integration-dependencies'] = {
        'owner': 'M01',
        'pending': ['正式会话 Cookie 名称', 'CSRF 获取及刷新流程', '统一鉴权和限流', '真实迁移历史'],
        'contractMetadata': {
            'method': 'GET', 'path': '/api/v1/meta/contract', 'implementedInM02': False,
            'responseFields': ['contractVersion', 'schemaVersion', 'baselineSha256', 'timezone'],
            'note': '由 M01 实现；schemaVersion 从实际迁移历史读取，不返回数据库连接信息。',
        },
    }

    # JSON Schema cannot encode a clock-dependent maximum. Do not freeze it to
    # this generator's execution year or confuse the SQL ceiling with API input.
    for name in ['HealthProfileInput', 'HealthProfile']:
        birth = schemas[name]['properties']['birthYear']
        birth.pop('maximum', None)
        birth['description'] = '可空整数；1900 至服务端当前上海年份（含）。9999 只是 SQL 的静态存储边界。'
        birth['x-dynamic-maximum'] = 'currentYear(Asia/Shanghai)'
    schemas['HealthProfileInput']['description'] = (
        '完整 PUT：五个必填字段必须提供；可选字段省略或传 null 都保存为 null。'
        '首次创建 version=0，创建后为 1；更新携带最新 version，冲突返回 409 VERSION_CONFLICT。'
        '小数项最多一位小数。不得发送 id、userId、updatedAt 或其他未声明字段。'
    )
    for name in ['WaterInput', 'WeightInput']:
        schemas[name]['properties']['recordedAt']['description'] = (
            '带明确时区的 ISO8601 时间，精确到秒或最多三位毫秒；例如 Z 或 +08:00。'
            '满足 operationNow - 30×24小时 <= recordedAt <= operationNow；省略时使用本事务 operationNow。'
            '入库转换为 UTC，businessDate 取 Asia/Shanghai 日期；历史补录不补发当天积分。'
        )
    for name in ['WaterPage', 'WeightPage']:
        schemas[name]['description'] = (
            'items 按 recordedAt、id 倒序；排除软删记录。nextCursor=null 表示结束。'
            '游标是原样传回的不透明字符串，绑定当前用户、记录类型及日期筛选；换账号或日期后从第一页开始。'
        )
    schemas['CreateWaterResult']['description'] = (
        'record 为本次记录；todaySummary 总是服务端当前上海业务日的累计，即使补录历史日期。'
        '无档案时 targetMl/progress 为 null；progress 为累计/当前目标，可能超过 1。'
        'awards 由 M05 同事务返回；历史补录或当日已获奖可为空，删除不恢复奖励资格。'
    )
    schemas['Error']['properties']['error']['properties']['code']['description'] = (
        '机器可读错误码。M02 常见码及触发条件见各操作 x-error-codes 和 API_GUIDE.md；'
        'M01 公共鉴权/限流层可能返回其他契约错误码。'
    )

    stamp = '2026-10-20T02:00:00.000Z'
    day = '2026-10-20'
    request_id = 'e0000000-0000-4000-8000-000000000001'
    user_id = 'a0000000-0000-4000-8000-000000000001'
    profile_id = 'e1000000-0000-4000-8000-000000000001'
    water_id = 'e2000000-0000-4000-8000-000000000001'
    weight_id = 'e3000000-0000-4000-8000-000000000001'
    meta = {'requestId': request_id, 'serverTime': stamp, 'timezone': 'Asia/Shanghai'}
    error_meta = {k: v for k, v in meta.items() if k != 'timezone'}
    profile_input = {
        'targetWeightKg': 60, 'waterTargetMl': 2000, 'calorieTargetKcal': 1800,
        'goalType': 'balanced', 'version': 0,
    }
    profile = {
        'id': profile_id, 'userId': user_id, 'heightCm': None, 'birthYear': None,
        **profile_input, 'carbsTargetG': None, 'proteinTargetG': None, 'fatTargetG': None,
        'version': 1, 'updatedAt': stamp,
    }
    water = {'id': water_id, 'amountMl': 250, 'recordedAt': stamp, 'businessDate': day, 'source': 'manual'}
    weight = {'id': weight_id, 'weightKg': 60.5, 'recordedAt': stamp, 'businessDate': day, 'source': 'manual'}
    dates = [(date.fromisoformat(day) - timedelta(days=n)).isoformat() for n in range(6, -1, -1)]
    nutrient = {'consumedG': 0, 'targetG': None, 'complete': True}
    dashboard = {
        'date': day, 'isDemo': False,
        'water': {'totalMl': 0, 'targetMl': None, 'progress': None},
        'weight': {k: None for k in ['latestKg', 'targetKg', 'previousKg', 'changeKg', 'bmi']},
        'energy': {'intakeKcal': 0, 'exerciseKcal': 0, **{k: None for k in ['baseTargetKcal', 'effectiveTargetKcal', 'remainingKcal', 'exceededKcal']}},
        'nutrients': {k: deepcopy(nutrient) for k in ['carbs', 'protein', 'fat']},
        'week': [{'date': d, 'hasMealRecord': False, 'hasTrainingRecord': False} for d in dates],
        'latestMeal': None, 'recommendedWorkout': None, 'pointsBalance': 0, 'dailyTasks': [], 'generatedAt': stamp,
    }
    overview = {
        'range': 7, 'startDate': dates[0], 'endDate': day, 'generatedAt': stamp,
        'summary': {'avgIntakeKcal': None, 'avgWaterMl': None, 'completedWorkouts': 0,
                    'totalExerciseKcal': 0, 'latestWeightKg': None, 'moodRecordedDays': 0,
                    'pointsBalance': 0, 'activeBookings': 0},
        'series': [{'date': d, 'intakeKcal': 0, 'exerciseKcal': 0, 'waterMl': 0,
                    'weightKg': None, 'mood': None, 'completedWorkouts': 0,
                    'hasMealRecord': False, 'hasWaterRecord': False} for d in dates],
        'coverage': {'mealDays': 0, 'waterDays': 0, 'weightDays': 0, 'moodDays': 0, 'rangeDays': 7},
    }
    success = {
        'getDashboard': dashboard, 'getHealthProfile': None, 'putHealthProfile': profile,
        'getOverview': overview, 'listWaterRecords': {'items': [water], 'nextCursor': None},
        'createWaterRecord': {'record': water, 'todaySummary': {'totalMl': 250, 'targetMl': 2000, 'progress': 0.125},
                              'awards': [{'id': 'e4000000-0000-4000-8000-000000000001', 'taskCode': 'daily_water', 'points': 5, 'businessDate': day, 'scopeKey': ''}]},
        'listWeightRecords': {'items': [weight], 'nextCursor': None}, 'createWeightRecord': weight,
    }
    requests = {'putHealthProfile': profile_input, 'createWaterRecord': {'amountMl': 250}, 'createWeightRecord': {'weightKg': 60.5}}
    descriptions = {
        'getDashboard': ('查询今日或指定上海日期的个人看板', 'date 省略时为当前上海业务日。历史页面使用当前目标；缺目标相关项为 null。同一只读快照读取跨组端口。'),
        'getHealthProfile': ('查询本人健康档案', '无档案时 200 且 data:null，不生成默认目标。此接口不接受查询参数。'),
        'putHealthProfile': ('完整保存本人健康档案', schemas['HealthProfileInput']['description']),
        'getOverview': ('查询近 7/30 天个人大屏', 'range 默认 7，endDate 默认当前上海日期。日期连续且包含结束日；缺体重/心情为 null，平均值按该类实际有记录天数计算。'),
        'listWaterRecords': ('分页查询指定日饮水记录', 'date 必填，按上海业务日筛选。limit 默认 20，范围 1—100。排序及游标规则见 WaterPage。'),
        'createWaterRecord': ('新增一条独立饮水记录', '每笔 1—1000 ml 整数；在用户锁内检查选中业务日有效累计不超过 6000 ml，此为录入边界。当天首次奖励由 M05 同事务处理；主动第二杯换新 key，网络重试沿用原 key 和原请求体。'),
        'deleteWaterRecord': ('软删除本人饮水记录', '有效小写 UUID v4。本人重复删除均为 204，无响应体；他人或不存在记录为 404。删除不回收原奖励，也不恢复当日领奖资格。'),
        'listWeightRecords': ('分页查询体重历史', 'startDate/endDate 必填，均含端点；结束不早于开始，最多 366 个自然日期（日期差不超过 365 天）。按 recordedAt、id 倒序，排除软删。'),
        'createWeightRecord': ('新增一次体重测量', '20—350 kg，最多一位小数。同日可多次。相同时间戳以 id 排序；允许的记录时间见 WeightInput。'),
        'deleteWeightRecord': ('软删除本人称重记录', '本人重复删除均为 204，无响应体；他人或不存在记录为 404。删除最新有效测量后显示剩余最近一次。'),
    }
    errors = {
        'UNAUTHENTICATED': (401, '未登录、会话过期或账号不可用。', 'M01 身份 / M02 身份检查'),
        'CSRF_INVALID': (403, '写请求缺少有效 CSRF；本地测试令牌必须匹配当前会话。', 'M01；本地为测试命令执行器'),
        'NOT_FOUND': (404, '要删除的记录不存在或不属于当前用户。', 'M02'),
        'VERSION_CONFLICT': (409, '首次档案已被创建，或提交的 version 已过期。', 'M02'),
        'IDEMPOTENCY_CONFLICT': (409, '同一用户、方法、路径及幂等键对应不同请求体。', 'M01；本地为测试命令执行器'),
        'REQUEST_IN_PROGRESS': (409, '同 key 的处理租约仍有效，或原执行者租约失效。稍后按原 key / 请求体重试。', 'M01；本地为测试命令执行器'),
        'WATER_DAILY_LIMIT': (409, '新增后该上海业务日的未删饮水记录累计将超过 6000 ml。', 'M02'),
        'VALIDATION_ERROR': (422, '参数、精度、时区、日期范围、游标或字段白名单校验失败。', 'M02 / 公共命令执行器'),
        'INTERNAL_ERROR': (500, '未识别的服务端异常；业务事务不提交部分结果。', 'M02 错误适配'),
    }
    for path, methods in paths.items():
        for method, op in methods.items():
            name = op['operationId']
            op['summary'], op['description'] = descriptions[name]
            op['description'] += ' 未声明的业务 Body/Query 字段返回 422；身份仅取自服务端会话。'
            op['parameters'].insert(0, {'name': 'X-Client-Platform', 'in': 'header', 'required': True,
                'description': '00 总契约规定的 H5 通用请求头，由 M01 公共入口按统一规则处理。',
                'schema': {'type': 'string', 'const': 'h5'}, 'example': 'h5'})
            for p in op['parameters']:
                key = p['name']
                if key in ['date', 'endDate', 'startDate']:
                    p['example'] = day if key != 'startDate' else dates[0]
                    p['description'] = 'YYYY-MM-DD，按 Asia/Shanghai 业务日期解释。' + ('省略时使用当前上海业务日。' if not p['required'] else '')
                elif key == 'timezone':
                    p['example'] = 'Asia/Shanghai'
                elif key == 'range':
                    p['example'] = 7
                elif key == 'cursor':
                    p['schema']['maxLength'] = 1500
                    p['description'] = '原样使用上页 nextCursor，不自行解码/拼接；绑定用户、记录类型和日期筛选，变更后必须清空。null 时不再请求下一页。'
                elif key == 'Idempotency-Key':
                    p['example'] = 'e5000000-0000-4000-8000-000000000001'
                    p['description'] = '小写 UUID v4。同一操作重试沿用同一 key 和原请求体；主动再记录一次生成新 key。'
                elif key == 'X-CSRF-Token':
                    p['description'] = '当前会话对应的 CSRF 令牌；由 M01 获取/刷新。本地测试通过 /dev/session 返回，仅用于开发。'
                elif key == 'id':
                    p['example'] = water_id if 'water' in path else weight_id
            if name in requests:
                op['requestBody']['content']['application/json']['examples'] = {
                    'minimalInput': {'summary': '最小合法请求；目标值仅为用户主动选择的示例', 'value': requests[name]},
                }
            codes = ['UNAUTHENTICATED', 'VALIDATION_ERROR', 'INTERNAL_ERROR']
            if method != 'get':
                codes.append('CSRF_INVALID')
            if method == 'delete':
                codes.append('NOT_FOUND')
            if method == 'post':
                codes += ['IDEMPOTENCY_CONFLICT', 'REQUEST_IN_PROGRESS']
            if name == 'putHealthProfile':
                codes.append('VERSION_CONFLICT')
            if name == 'createWaterRecord':
                codes.append('WATER_DAILY_LIMIT')
            op['x-error-codes'] = [{'code': c, 'status': errors[c][0], 'when': errors[c][1], 'owner': errors[c][2]} for c in codes]
            for c in codes:
                status, reason, owner = errors[c]
                value = {'error': {'code': c, 'message': reason}, 'meta': deepcopy(error_meta)}
                if c == 'VALIDATION_ERROR':
                    value['error']['fields'] = {'query' if method == 'get' else 'body': '请按接口声明提供合法字段。'}
                media = op['responses'][str(status)]['content']['application/json']
                media.setdefault('examples', {})[c] = {'summary': reason, 'value': value}
            success_status = '204' if method == 'delete' else '201' if method == 'post' else '200'
            if name in success:
                op['responses'][success_status]['content']['application/json']['examples'] = {
                    'documentExample': {'summary': '构造的契约示例；非数据库实测值', 'value': {'data': success[name], 'meta': deepcopy(meta)}},
                }
            else:
                op['responses'][success_status]['description'] = '删除成功或本人重复删除；响应体为空，不返回 JSON。'
    return doc
