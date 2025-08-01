const logger = require('../utils/logger');

const rateLimit = require('express-rate-limit');

const requestLogger = (req, res, next) => {
    const start = Date.now();
    
    const logRequest = () => {
        const duration = Date.now() - start;
        
        logger.info('Request completed', {
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });
    };

    res.on('finish', logRequest);
    res.on('close', logRequest);

    // Only log request body in development or for callback endpoints
    const shouldLogBody = process.env.NODE_ENV === 'development' || 
                         req.originalUrl.includes('/callback');

    logger.info('Request received', {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        body: (req.method === 'POST' && shouldLogBody) ? req.body : undefined
    });

    next();
};

// Rate limiting configurations
const createRateLimit = (windowMs, max, message) => rateLimit({
    windowMs,
    max,
    message: {
        success: false,
        error: message,
        retryAfter: Math.ceil(windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Skip rate limiting for health checks
        return req.originalUrl === '/api/health';
    }
});

const generalRateLimit = createRateLimit(
    15 * 60 * 1000, // 15 minutes
    100, // limit each IP to 100 requests per windowMs
    'Too many requests from this IP, please try again later'
);

const callbackRateLimit = createRateLimit(
    1 * 60 * 1000, // 1 minute
    60, // limit each IP to 60 callback requests per minute
    'Too many callback requests, please slow down'
);

const strictRateLimit = createRateLimit(
    15 * 60 * 1000, // 15 minutes
    20, // limit each IP to 20 requests per windowMs for sensitive endpoints
    'Rate limit exceeded for this endpoint'
);

const securityHeaders = (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    if (req.secure) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    
    next();
};

const corsConfig = {
    origin: (origin, callback) => {
        const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];
        
        if (allowedOrigins.includes('*') || !origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

const healthCheck = (req, res) => {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    
    res.status(200).json({
        success: true,
        timestamp: new Date().toISOString(),
        uptime: `${Math.floor(uptime)}s`,
        memory: {
            used: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
            total: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`
        },
        environment: process.env.NODE_ENV || 'development'
    });
};

module.exports = {
    requestLogger,
    securityHeaders,
    corsConfig,
    healthCheck,
    generalRateLimit,
    callbackRateLimit,
    strictRateLimit
};