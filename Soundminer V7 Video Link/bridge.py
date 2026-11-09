import json,subprocess,time,select,os,sys
from pathlib import Path
root=Path(sys.argv[1]); token=sys.argv[2]
p=None
buf=b'';seq=0

def request(method,params):
 global seq,buf
 seq+=1; ident=seq
 p.stdin.write((json.dumps(dict(jsonrpc='2.0',id=ident,method=method,params=params))+'\n').encode())
 end=time.monotonic()+3
 while time.monotonic()<end:
  while b'\n' in buf:
   line,buf=buf.split(b'\n',1); data=json.loads(line)
   if data.get('id')==ident:
    if 'error' in data:raise RuntimeError(str(data['error']))
    return data['result']
  if select.select([p.stdout],[],[],.1)[0]:
   chunk=os.read(p.stdout.fileno(),65536)
   if not chunk:raise RuntimeError('MCP server closed')
   buf+=chunk
 raise TimeoutError('Soundminer did not respond')
def call(name,args={}):
 out=request('tools/call',dict(name=name,arguments=args))
 if out.get('isError'):raise RuntimeError(str(out))
 result=json.loads(next(c['text'] for c in out['content'] if c['type']=='text'))
 if result.get('ok') is False:raise RuntimeError(str(result))
 return result

def atomic(name,text):
 f=root/(name+'.tmp');f.write_text(text);f.replace(root/name)
try:
 config=Path(__file__).with_name('mcp-server-path.txt')
 candidates=([Path(config.read_text().strip()).expanduser()] if config.exists() else [])
 candidates += [Path('/Applications/Soundminer v7.app/Contents/Resources/SMMCPServer'),Path.home()/'Applications/Soundminer v7.app/Contents/Resources/SMMCPServer']
 server=next((v for v in candidates if v.is_file() and os.access(v,os.X_OK)),None)
 if not server:raise RuntimeError('Cannot find the V7 MCP server. Install Soundminer V7, or put the full SMMCPServer path in mcp-server-path.txt beside bridge.py.')
 p=subprocess.Popen([str(server)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,bufsize=0)
 request('initialize' ,dict(protocolVersion='2024-11-05',capabilities={},clientInfo=dict(name='REAPER audition link',version='1')))
 p.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
 commands=call('list_commands',{'filter':'pause'})['commands']
 matches=[c for c in commands if c['name']=='Toggle Play']
 if len(matches)!=1:raise RuntimeError('This V7 build does not expose the expected Toggle Play command.')
 play_id=matches[0]['id']
 last=''; ack='0'
 while True:
  lease=(root/'lease').read_text().split()
  if lease[0]!=token or time.time()-float(lease[1])>5:break
  state=call('get_transport')
  command=(root/'command').read_text() if (root/'command').exists() else ''
  if command and command!=last:
   last=command
   if command.endswith('return'):
    if state['is_playing']:call('invoke_command',dict(command_id=play_id,wait_ms=1000))
    state=call('get_transport');ack=command.split()[0]
  atomic('state',' '.join(map(str,[token,time.time(),int(state['is_playing']),state['position_seconds'],state['total_seconds'],int(state['has_file']),ack])))
  time.sleep(.03)
except Exception as e:atomic('error',str(e))
finally:
 if p is not None:
  p.terminate()
  try:p.wait(timeout=2)
  except subprocess.TimeoutExpired:p.kill();p.wait()
