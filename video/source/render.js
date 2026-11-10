const {chromium}=require('playwright');const {spawn}=require('child_process');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1280,height:720}});
await p.goto('file://'+__dirname+'/video.html');await p.waitForTimeout(800);
const T=await p.evaluate(()=>TOTAL);const FPS=25,N=Math.ceil(T*FPS);
const ff=spawn('ffmpeg',['-y','-v','error','-f','image2pipe','-framerate',String(FPS),'-c:v','mjpeg','-i','-','-c:v','libx264','-pix_fmt','yuv420p','-crf','20','-preset','medium','silent.mp4'],{stdio:['pipe','inherit','inherit']});
for(let i=0;i<N;i++){await p.evaluate(t=>seek(t),i/FPS);const buf=await p.screenshot({type:'jpeg',quality:92});
 if(!ff.stdin.write(buf))await new Promise(r=>ff.stdin.once('drain',r)); if(i%500==0)console.log(i,'/',N);}
ff.stdin.end();await new Promise(r=>ff.on('close',r));await b.close();console.log('done');})();
