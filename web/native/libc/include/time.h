#ifndef _WEB_TIME_H
#define _WEB_TIME_H
typedef long clock_t;
typedef long long time_t;
#define CLOCKS_PER_SEC 1000
clock_t clock(void);
#endif
