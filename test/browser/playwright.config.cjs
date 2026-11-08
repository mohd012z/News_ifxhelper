const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
 testDir:'.',testMatch:'bbma-v5.chromium.spec.cjs',
 timeout:20000,globalTimeout:120000,retries:0,workers:1,
 use:{browserName:'chromium',headless:true,trace:'retain-on-failure',screenshot:'only-on-failure'},
 reporter:[['line']],
 outputDir:'../../test-results/helix-chromium'
});
