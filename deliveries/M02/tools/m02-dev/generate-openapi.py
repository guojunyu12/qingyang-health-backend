from pathlib import Path
import json
from openapi_details import enrich
S={}
def ref(n): return {'$ref':'#/components/schemas/'+n}
def obj(p,required=None):return {'type':'object','properties':p,'required':required if required is not None else list(p),'additionalProperties':False}
def num(lo=None,hi=None,nullable=False,integer=False):
 d={'type':['integer' if integer else 'number','null'] if nullable else 'integer' if integer else 'number'}
 if lo is not None:d['minimum']=lo
 if hi is not None:d['maximum']=hi
 return d
string={'type':'string'}; date={'type':'string','format':'date'}; instant={'type':'string','format':'date-time'}
uuid={'type':'string','format':'uuid','pattern':'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'}
boolean={'type':'boolean'}; nullable_number=num(nullable=True); arr=lambda v:{'type':'array','items':v}
S['Meta']=obj({'requestId':uuid,'serverTime':instant,'timezone':{'const':'Asia/Shanghai'}})
S['Error']=obj({'error':obj({'code':string,'message':string,'fields':{'type':'object','additionalProperties':string},'retryAfterSeconds':num(0,integer=True)},['code','message']),'meta':obj({'requestId':uuid,'serverTime':instant})})
profile={'heightCm':num(50,250,True),'birthYear':num(1900,9999,True,True),'targetWeightKg':num(20,350),'waterTargetMl':num(500,6000,integer=True),'calorieTargetKcal':num(800,5000),'carbsTargetG':num(0,1000,True),'proteinTargetG':num(0,1000,True),'fatTargetG':num(0,1000,True),'goalType':{'enum':['balanced','maintain','lose','gain']},'version':num(0,2147483646,integer=True)}
for key in ['heightCm','targetWeightKg','calorieTargetKcal','carbsTargetG','proteinTargetG','fatTargetG']:profile[key]['multipleOf']=0.1
S['HealthProfileInput']=obj(profile,['targetWeightKg','waterTargetMl','calorieTargetKcal','goalType','version'])
S['HealthProfile']=obj({**profile,'version':num(1,integer=True),'id':uuid,'userId':uuid,'updatedAt':instant})
common={'id':uuid,'recordedAt':instant,'businessDate':date,'source':{'const':'manual'}}
S['WaterRecord']=obj({**common,'amountMl':num(1,1000,integer=True)})
S['WeightRecord']=obj({**common,'weightKg':{**num(20,350),'multipleOf':0.1}})
for name,key,number in [('Water','amountMl',num(1,1000,integer=True)),('Weight','weightKg',{**num(20,350),'multipleOf':0.1})]:
 S[name+'Input']=obj({key:number,'recordedAt':{**instant,'description':'必须含时区，当前时刻之前30天内；未填使用同事务服务端 operationNow'},'source':{'const':'manual'}},[key])
 S[name+'Page']=obj({'items':arr(ref(name+'Record')),'nextCursor':{'type':['string','null']}})
S['WaterSummary']=obj({'totalMl':num(0,6000,integer=True),'targetMl':nullable_number,'progress':nullable_number})
S['PointAward']=obj({'id':uuid,'taskCode':{'enum':['daily_checkin','daily_water','daily_meal','course_workout']},'points':num(1,integer=True),'businessDate':date,'scopeKey':string})
S['CreateWaterResult']=obj({'record':ref('WaterRecord'),'todaySummary':ref('WaterSummary'),'awards':arr(ref('PointAward'))})
# Exact shared cross-module DTO shapes; no mock-specific additions.
S['MealItem']=obj({'id':uuid,'foodId':{'oneOf':[uuid,{'type':'null'}]},'name':string,'grams':num(),'caloriesKcal':num(),'carbsG':nullable_number,'proteinG':nullable_number,'fatG':nullable_number,'nutritionSource':{'enum':['catalog','model','user']},'confidence':nullable_number})
S['Meal']=obj({'id':uuid,'mealType':{'enum':['breakfast','lunch','dinner','snack']},'recordedAt':instant,'businessDate':date,'source':{'enum':['manual','photo']},'photoAssetId':{'oneOf':[uuid,{'type':'null'}]},'photoUrl':{'type':['string','null']},'items':arr(ref('MealItem')),'totals':obj({'caloriesKcal':num(),'carbsG':nullable_number,'proteinG':nullable_number,'fatG':nullable_number}),'version':num(integer=True),'createdAt':instant,'updatedAt':instant})
S['Course']=obj({'id':uuid,'title':string,'category':{'enum':['stretch','strength','cardio']},'level':{'enum':['beginner','intermediate']},'description':string,'coverUrl':{'type':['string','null']},'videoUrl':{'type':['string','null']},'estimatedDurationSeconds':num(integer=True),'estimatedCaloriesKcal':num(),'status':{'enum':['draft','published','archived']},'version':num(integer=True)})
S['Task']=obj({'code':{'enum':['daily_checkin','daily_water','daily_meal','course_workout']},'title':string,'description':string,'rewardPoints':num(integer=True),'progress':num(),'target':num(),'status':{'enum':['pending','completed']},'completedAt':{'oneOf':[instant,{'type':'null'}]},'action':obj({'type':{'enum':['navigate','checkin']},'path':string},['type'])})
nutrient=obj({'consumedG':num(),'targetG':nullable_number,'complete':boolean})
S['Dashboard']=obj({'date':date,'isDemo':{'const':False},'water':ref('WaterSummary'),'weight':obj({k:nullable_number for k in ['latestKg','targetKg','previousKg','changeKg','bmi']}),'energy':obj({k:(num() if k in ['intakeKcal','exerciseKcal'] else nullable_number) for k in ['intakeKcal','exerciseKcal','baseTargetKcal','effectiveTargetKcal','remainingKcal','exceededKcal']}),'nutrients':obj({k:nutrient for k in ['carbs','protein','fat']}),'week':arr(obj({'date':date,'hasMealRecord':boolean,'hasTrainingRecord':boolean})),'latestMeal':{'oneOf':[ref('Meal'),{'type':'null'}]},'recommendedWorkout':{'oneOf':[ref('Course'),{'type':'null'}]},'pointsBalance':num(integer=True),'dailyTasks':arr(ref('Task')),'generatedAt':instant})
S['Overview']=obj({'range':{'enum':[7,30]},'startDate':date,'endDate':date,'generatedAt':instant,'summary':obj({**{k:nullable_number for k in ['avgIntakeKcal','avgWaterMl','latestWeightKg']},**{k:num(integer=True) for k in ['completedWorkouts','moodRecordedDays','pointsBalance','activeBookings']},'totalExerciseKcal':num()}),'series':arr(obj({'date':date,'intakeKcal':num(),'exerciseKcal':num(),'waterMl':num(integer=True),'weightKg':nullable_number,'mood':{'enum':['happy','calm','tired','low',None]},'completedWorkouts':num(integer=True),'hasMealRecord':boolean,'hasWaterRecord':boolean})),'coverage':obj({k:num(0,30,integer=True) for k in ['mealDays','waterDays','weightDays','moodDays','rangeDays']})})
paths={}
def param(name,schema,required=False,where='query'):return {'name':name,'in':where,'required':required,'schema':schema}
def operation(path,method,name,response=None,body=None,params=None,created=False):
 status='204' if method=='delete' else '201' if created else '200'
 responses={status:{'description':'成功'}}
 if response:responses[status]['content']={'application/json':{'schema':obj({'data':response,'meta':ref('Meta')})}}
 for code in ['401','403','404','409','422','500']:responses[code]={'description':{'401':'未登录','403':'权限或 CSRF','404':'记录不存在或非本人','409':'版本/幂等/业务冲突','422':'参数不合法','500':'服务错误'}[code],'content':{'application/json':{'schema':ref('Error')}}}
 parameters=params or []
 if method!='get':parameters=parameters+[param('X-CSRF-Token',string,True,'header')]
 if method=='post':parameters=parameters+[param('Idempotency-Key',uuid,True,'header')]
 op={'operationId':name,'tags':['M02'],'responses':responses,'parameters':parameters,'security':[{'cookieAuth':[]}]}
 if body:op['requestBody']={'required':True,'content':{'application/json':{'schema':ref(body)}}}
 paths.setdefault(path,{})[method]=op
operation('/me/dashboard','get','getDashboard',ref('Dashboard'),params=[param('date',date),param('timezone',{'const':'Asia/Shanghai'})])
operation('/me/health-profile','get','getHealthProfile',{'oneOf':[ref('HealthProfile'),{'type':'null'}]})
operation('/me/health-profile','put','putHealthProfile',ref('HealthProfile'),body='HealthProfileInput')
operation('/me/health/overview','get','getOverview',ref('Overview'),params=[param('range',{'enum':[7,30],'default':7}),param('endDate',date)])
for kind in ['water','weight']:
 n=kind.title();base=f'/me/{kind}-records';paging=[param('limit',{'type':'integer','minimum':1,'maximum':100,'default':20}),param('cursor',string)]
 dates=[param('date',date,True)] if kind=='water' else [param('startDate',date,True),param('endDate',date,True)]
 operation(base,'get','list'+n+'Records',ref(n+'Page'),params=dates+paging)
 operation(base,'post','create'+n+'Record',ref('CreateWaterResult' if kind=='water' else 'WeightRecord'),body=n+'Input',created=True)
 operation(base+'/{id}','delete','delete'+n+'Record',params=[param('id',uuid,True,'path')])
doc={'openapi':'3.1.0','info':{'title':'轻养 M02 健康记录与个人看板','version':'QY-MYSQL-1.0.0','description':'10 个接口；共享身份、幂等、CSRF 与 envelope 由 M01 装配。仅 M02 三张健康表。'},'servers':[{'url':'/api/v1'}],'paths':paths,'components':{'securitySchemes':{'cookieAuth':{'type':'apiKey','in':'cookie','name':'session'}},'schemas':S}}
doc = enrich(doc)
Path(__file__).resolve().parents[2].joinpath('contracts/openapi/M02.yaml').write_text(json.dumps(doc,ensure_ascii=False,indent=2)+'\n')
print('Generated OpenAPI 3.1 (JSON-compatible YAML):',sum(len(p) for p in paths.values()),'operations')
