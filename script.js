document.addEventListener('DOMContentLoaded', () => {
  const GITHUB_USERNAME = 'sahibdeepme';
  const REPO_NAME = 'canvas';
  const BRANCH = 'main'; // Change to 'master' if your repo default branch is master

  const tokenInput = document.getElementById('gh-token');
  const slugInput = document.getElementById('project-slug');
  const dropZone = document.getElementById('drop-zone');
  const folderInput = document.getElementById('folder-input');
  const multiFileInput = document.getElementById('multi-file-input');
  const btnSelectFolder = document.getElementById('btn-select-folder');
  const btnSelectFiles = document.getElementById('btn-select-files');
  const fileManifest = document.getElementById('file-manifest');
  const publishBtn = document.getElementById('publish-btn');
  const outputSection = document.getElementById('output-section');
  const outputUrl = document.getElementById('output-url');
  const copyBtn = document.getElementById('copy-btn');
  const openBtn = document.getElementById('open-btn');

  let selectedFiles = [];

  // Restore saved token
  const savedToken = localStorage.getItem('canvas_gh_token');
  if (savedToken && tokenInput) tokenInput.value = savedToken;

  // File pickers trigger
  btnSelectFolder.addEventListener('click', (e) => { e.stopPropagation(); folderInput.click(); });
  btnSelectFiles.addEventListener('click', (e) => { e.stopPropagation(); multiFileInput.click(); });
  dropZone.addEventListener('click', () => multiFileInput.click());

  folderInput.addEventListener('change', (e) => handleFiles(e.target.files));
  multiFileInput.addEventListener('change', (e) => handleFiles(e.target.files));

  // Drag & Drop
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });

  function handleFiles(files) {
    selectedFiles = Array.from(files);
    if (!selectedFiles.length) return;

    fileManifest.innerHTML = '';
    fileManifest.style.display = 'block';

    selectedFiles.forEach(file => {
      // Keep relative path if available from folder upload, else file name
      const relativePath = file.webkitRelativePath || file.name;
      const row = document.createElement('div');
      row.className = 'file-item';
      row.innerHTML = `<span>${relativePath}</span><span class="file-size">${(file.size / 1024).toFixed(1)} KB</span>`;
      fileManifest.appendChild(row);
    });

    // Auto slug suggestion from directory or first file
    if (!slugInput.value.trim()) {
      const firstPath = selectedFiles[0].webkitRelativePath || selectedFiles[0].name;
      const rootFolderName = firstPath.includes('/') ? firstPath.split('/')[0] : firstPath.replace(/\.[^/.]+$/, '');
      slugInput.value = rootFolderName.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    }

    publishBtn.disabled = false;
  }

  // Convert File to Base64 String
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  publishBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    const rawSlug = slugInput.value.trim();

    if (!token) return alert('Please enter your GitHub Personal Access Token.');
    if (!rawSlug) return alert('Please provide a project name.');
    if (!selectedFiles.length) return alert('No files selected.');

    const slug = rawSlug.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    localStorage.setItem('canvas_gh_token', token);

    publishBtn.disabled = true;
    publishBtn.textContent = 'Deploying site structure...';

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };

    try {
      // 1. Get the latest commit SHA of the target branch
      const refRes = await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}/git/ref/heads/${BRANCH}`, { headers });
      if (!refRes.ok) throw new Error('Could not access repository branch.');
      const refData = await refRes.json();
      const latestCommitSha = refData.object.sha;

      // 2. Upload each file as a git Blob (handles HTML, CSS, JS, Images, WOFF, etc.)
      publishBtn.textContent = `Uploading ${selectedFiles.length} assets...`;
      const treeItems = [];

      for (const file of selectedFiles) {
        let cleanPath = file.webkitRelativePath || file.name;
        // Strip out parent folder name if uploaded via webkitdirectory so relative links work
        if (cleanPath.includes('/')) {
          cleanPath = cleanPath.substring(cleanPath.indexOf('/') + 1);
        }

        const b64 = await fileToBase64(file);

        const blobRes = await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}/git/blobs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ content: b64, encoding: 'base64' })
        });

        if (!blobRes.ok) throw new Error(`Failed to process blob for ${cleanPath}`);
        const blobData = await blobRes.json();

        treeItems.push({
          path: `p/${slug}/${cleanPath}`,
          mode: '100644', // normal file
          type: 'blob',
          sha: blobData.sha
        });
      }

      // 3. Create a Git Tree combining all assets
      publishBtn.textContent = 'Assembling file tree...';
      const treeRes = await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}/git/trees`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          base_tree: latestCommitSha,
          tree: treeItems
        })
      });
      const treeData = await treeRes.json();

      // 4. Commit the new tree
      publishBtn.textContent = 'Finalizing commit...';
      const commitRes = await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}/git/commits`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: `Deploy full bundle for ${slug} via Canvas`,
          tree: treeData.sha,
          parents: [latestCommitSha]
        })
      });
      const commitData = await commitRes.json();

      // 5. Update branch pointer
      await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}/git/refs/heads/${BRANCH}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ sha: commitData.sha })
      });

      // Target URL: If folder had index.html, it opens directly
      const finalUrl = `https://${GITHUB_USERNAME}.github.io/${REPO_NAME}/p/${slug}/`;
      outputUrl.value = finalUrl;
      outputSection.style.display = 'block';

    } catch (err) {
      alert('Deployment error: ' + err.message);
    } finally {
      publishBtn.disabled = false;
      publishBtn.textContent = 'Deploy Complete Site';
    }
  });

  copyBtn.addEventListener('click', () => {
    outputUrl.select();
    navigator.clipboard.writeText(outputUrl.value);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
  });

  openBtn.addEventListener('click', () => {
    if (outputUrl.value) window.open(outputUrl.value, '_blank');
  });
});