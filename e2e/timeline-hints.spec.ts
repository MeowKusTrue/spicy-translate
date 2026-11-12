import { expect, test } from '@playwright/test';

test('timeline hover hints are off by default, switch immediately and persist without altering timing', async ({ page, request }) => {
  const fixture = {v:1,meta:{title:'Hints',artist:'Test',lang:'ru',mode:'original',md:[]},lines:[{t:0,end:4,text:'test word',tr:'',sync:{orig:[{a:0,b:2},{a:2,b:4}]}}]};
  await request.put('/api/project?by=page',{data:fixture});
  await page.addInitScript(()=>localStorage.setItem('helpSeen','1'));
  await page.goto('/');await page.locator('#nav-sync').click();
  const hover = async () => { const b=(await page.locator('#wave').boundingBox())!;await page.mouse.move(b.x+180,b.y+8); };
  await hover();await expect(page.locator('#waveTip')).toBeHidden();
  await page.locator('#btnEditorCommands').click();await expect(page.locator('#waveHints')).not.toBeChecked();
  await page.locator('#waveHints').check();await hover();await expect(page.locator('#waveTip')).toBeVisible();
  await page.locator('#waveHints').uncheck();await expect(page.locator('#waveTip')).toBeHidden();
  await hover();await expect(page.locator('#waveTip')).toBeHidden();
  await page.reload();await page.locator('#nav-sync').click();
  if(await page.locator('#editorCommands').isHidden())await page.locator('#btnEditorCommands').click();
  await expect(page.locator('#waveHints')).not.toBeChecked();await hover();await expect(page.locator('#waveTip')).toBeHidden();
  expect((await(await request.get('/api/project')).json()).project.lines).toEqual(fixture.lines);
});
