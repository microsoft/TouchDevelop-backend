# Streaming data API

## Creating a stream

```
POST /api/streams
{
    "name": "My stream",
    "target": "microbit"
}
```

The name and target are optional. Both are used when rendering the stream page at
`/lxmsmqjlwucg`. The response will look like this (in JSON):

```json
{
  "kind": "stream",
  "id": "lxmsmqjlwucg",
  "time": 1461862043,
  "name": "My stream",
  "target": "microbit",
  "meta": {
    "fields": [],
    "size": 0,
    "rows": 0,
    "batches": 0
  },
  "privatekey": "XPbHZzTsBiimirjvVgVlzmIX"
}
```

## Posting data to a stream

```
POST /api/lxmsmqjlwucg/data?privatekey=XPbHZzTsBiimirjvVgVlzmIX
{
    "fields": ["timestamp", "temp"], 
    "values": [
        [1461859756478, 20.5], 
        [1461859756078, 21.22]
    ]    
}
```

The format is somewhat similar to CSV - you specify the "header" with `fields`
and then specify one or more rows of values (samples) in `values`.

The first field has to be `timestamp` and specify the time when the sample was
taken as number of milliseconds since epoch (Jan 1st 1970). This is what JavaScript
`Date.getTime()` method returns.

All `fields` and each row of `values` has to have the same number of element.
Use `null` to indicate no value. Field names have to be at most 60 characters
and have to match `/^[a-zA-Z][a-zA-Z0-9_]*$/`. Values can be numbers or `null`.

The response is:

```json
{
  "meta": { ... },
  "quotaUsedHere": 46,
  "quotaLeft": 52428708
}
```

`meta` field is the same as below. `quotaUsedHere` is the amount of per-stream quota
consumed by the post, and `quotaLeft` is amount of quoata remaining.

## Deleting stream

```
DELETE /api/lxmsmqjlwucg?privatekey=XPbHZzTsBiimirjvVgVlzmIX
```

This is irevocable and actually deletes the data.

## Querying stream meta info

```
GET /api/lxmsmqjlwucg
```

Response:

```json
{                                
  "kind": "stream",              
  "id": "lxmsmqjlwucg",          
  "time": 1461862043,            
  "name": "My stream",           
  "meta": {                      
    "fields": [                  
      {                          
        "name": "timestamp",     
        "sum": 5847439025112,    
        "min": 1461859756078,    
        "max": 1461859756478,    
        "count": 4               
      },                         
      {                          
        "name": "temp",          
        "sum": 83.44,            
        "min": 20.5,             
        "max": 21.22,            
        "count": 4               
      }                          
    ],                           
    "size": 92,                  
    "rows": 4,                   
    "batches": 2                 
  }                              
}                                
```

`time` is creation time (in seconds, not milliseconds, since epoch).
`meta` specifies various stream information - the quota size of this
stream, the number of rows and the number of post operations used
to create it (`batches`). It also lists all the fields in the stream
with their total minimum, maximum, number of times they were supplied
in a row (this never greater than `rows` but can be smaller if some
samples omit this field). There is also sum of values of this field,
which lets you compute the average. Count on `timestamp` field is always the
same as `rows`.

## Querying stream data

This will query samples from three hours from now, until now. You can also
use absolute time in `start` and `stop` (milliseconds from epoch).
Acceptable units are `-1s, -1m, -1h, -1d, -1y`. It always has to be `-<number><unit>`.

If there is more data to return, the `continuationUrl` will give you a URL
where to look for it. You can also append `?continuation=<value of continuation field>`
to your query URL.

```
GET /api/lxmsmqjlwucg/data?start=-3h&stop=-0s
```

```json
{
  "fields": [
    {
      "name": "timestamp",
      "sum": 5847439025112,
      "min": 1461859756078,
      "max": 1461859756478,
      "count": 4
    },
    {
      "name": "temp",
      "sum": 83.44,
      "min": 20.5,
      "max": 21.22,
      "count": 4
    }
  ],
  "values": [
    [ 1461859756078, 21.22 ],
    [ 1461859756079, 21.22 ],
    [ 1461859756478, 20.5 ],
    [ 1461859756480  20.5 ]
  ],
  "continuation": "",
  "continuationUrl": ""
}
```

Instead of `.../data` you can use `.../data.csv` to get data in CSV format. The CSV data
omits partition (as it's the same in the entire file), and converts timestamp field
into a UTC time representation that Excel understands.

## OData

It's best avoided.

There is some OData support at `/api/lxmsmqjlwucg/odata/` and 
`/api/lxmsmqjlwucg/odata/Samples`, but it's far from complete.
Also, when importing into Excel, it rounds up time to seconds (instead of milliseconds).

## Partitions

You can include `partition` numeric field in samples. All samples
in a batch have to have the same partition. You can then specify
`?partition=...` in query. Partition defaults to `0`, both when
posting and querying. 


## Quotas and throttling

* 50MB per-stream limit
* 32 fields per stream max
* At most 1 post per stream per minute (bursts of up to 60 every hour acceptable)
* Similarly, for queries
* At most 1 api request from an IP per 2 seconds

## Error responses

All endpoints describe here return HTTP 200 on success.

In case you exceed throttling limit they return HTTP 429. It applies to creating streams,
posting data, and querying. In case you're just a few seconds over the throttling limit,
the server will block for these few seconds and then return HTTP 200.

If you exceed the 50MB quota, you'll get HTTP 412 when posting data.

HTTP 400 signals various error with the input request. Inspect JSON response for
exact error message.
