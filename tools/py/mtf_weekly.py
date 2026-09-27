from datetime import datetime, timezone, timedelta

MINUTES={'M1':1,'M5':5,'M15':15,'M30':30,'H1':60,'H4':240,'D1':1440,'W1':10080}

def parse(value):
    if isinstance(value, datetime):
        dt=value
    else:
        dt=datetime.fromisoformat(str(value).replace('Z','+00:00'))
    if dt.tzinfo is None: dt=dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def week_start(value):
    d=parse(value)
    start=(d-timedelta(days=d.weekday())).replace(hour=0,minute=0,second=0,microsecond=0)
    return start.isoformat()

def month_start(value):
    d=parse(value)
    return d.replace(day=1,hour=0,minute=0,second=0,microsecond=0).isoformat()

def week_of_month(value):
    return (parse(value).day-1)//7+1

def exact_next(value,timeframe):
    if timeframe not in MINUTES: raise ValueError('calendar/unsupported timeframe requires explicit boundary logic')
    return (parse(value)+timedelta(minutes=MINUTES[timeframe])).isoformat()
