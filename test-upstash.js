const Redis = require('ioredis');

async function testUpstash() {
  console.log('Testing Upstash Redis connection...\n');
  
  const redisUrl = "rediss://default:AWu_AAIncDEwNTE1YmFjMDc4NWY0N2JjOGFkYmE1MDQyYjllZTExY3AxMjc1ODM@feasible-ladybug-27583.upstash.io:6379";
  
  const redis = new Redis(redisUrl, {
    tls: {},
    connectTimeout: 10000,
  });
  
  // Add event listeners
  redis.on('connect', () => console.log('Event: connect'));
  redis.on('error', (err) => console.log('Event: error:', err.message));
  redis.on('ready', () => console.log('Event: ready'));
  
  try {
    console.log('Pinging Redis...');
    const pong = await redis.ping();
    console.log(`✅ Ping response: ${pong}`);
    
    console.log('\nTesting set/get...');
    await redis.set('test-key', 'Hello Upstash!');
    const value = await redis.get('test-key');
    console.log(`✅ Get response: ${value}`);
    
    await redis.del('test-key');
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  } finally {
    await redis.quit();
    console.log('\nConnection closed');
  }
}

testUpstash().catch(console.error);
