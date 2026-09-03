document.addEventListener('DOMContentLoaded', () => {
  // Dynamically resolve username and repo name from the GitHub Pages URL
  const hostnameParts = window.location.hostname.split('.');
  const pathSegments = window.location.pathname.split('/').filter(Boolean);

  const GITHUB_USERNAME = hostnameParts[0] || 'SahibdeepMe';
  const REPO_NAME = pathSegments[0] || 'hoster';
  const BRANCH = 'main'; // Change to 'master' if your default branch is master

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

  // Restore saved token from local storage
  const savedToken = localStorage.getItem('hoster_gh_token') || localStorage.getItem('canvas_gh_token');
  if (savedToken && tokenInput) {
    tokenInput.value = savedToken;
  }

  // File picker trigger handlers
  if (btnSelectFolder && folderInput) {
    btnSelectFolder.addEventListener('click', (e) => {
      e.stopPropagation();
      folderInput.click();
    });
  }

  if (btnSelectFiles && multiFileInput) {
    btnSelectFiles.addEventListener('click', (e) => {
      e.stopPropagation();
      multiFileInput.click();
    });
  }

  if (dropZone && multiFileInput) {
    dropZone.addEventListener('click', () => multiFileInput.click());

    // Drag and drop events
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        handleFiles(e.dataTransfer.files);
      }
    });
  }

  if (folderInput) {
    folderInput.addEventListener('change', (e) => handleFiles(e.target.files));
  }

  if (multiFileInput) {
    multiFileInput.addEventListener('change', (e) => handleFiles(e.target.files));
  }

  function handleFiles(files) {
    selectedFiles = Array.from(files);
    if (!selectedFiles.length) return;

    fileManifest.innerHTML = '';
    fileManifest.style.display = 'block';

    selectedFiles.forEach((file) => {
      const relativePath = file.webkitRelativePath || file.name;
      const row = document.createElement('div');
      row.className = 'file-item';
      row.innerHTML = `<span>${relativePath}</span><span class="file-size">${(file.size / 1024).toFixed(1)} KB</span>`;
      fileManifest.appendChild(row);
    });

    // Automatically create a slug based on directory name or first file name
    if (!slugInput.value.trim()) {
      const firstPath = selectedFiles[0].webkitRelativePath || selectedFiles[0].name;
      const rootFolderName = firstPath.includes('/')
        ? firstPath.split('/')[0]
        : firstPath.replace(/\.[^/.]+$/, '');
      slugInput.value = rootFolderName.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    }

    publishBtn.disabled = false;
  }

  // Convert File blob to Base64 String
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

  // Deploy process using GitHub Git Data Trees API
  if (publishBtn) {
    publishBtn.addEventListener('click', async () => {
      const token = tokenInput.value.trim();
      const rawSlug = slugInput.value.trim();

      if (!token) {
        alert('Please enter your GitHub Personal Access Token.');
        tokenInput.focus();
        return;
      }

      if (!rawSlug) {
        alert('Please provide a project name.');
        slugInput.focus();
        return;
      }

      if (!selectedFiles.length) {
        alert('No files selected.');
        return;
      }

      const slug = rawSlug.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
      localStorage.setItem('hoster_gh_token', token);

      publishBtn.disabled = true;
      publishBtn.textContent = 'Connecting to repository...';

      const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      };

      try {
        // Step 1: Retrieve latest commit SHA from the branch
        const refRes = await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}/git/ref/heads/${BRANCH}`, { headers });
        if (!refRes.ok) {
          throw new Error(`Could not access repository ${REPO_NAME}. Ensure token has 'repo' scope.`);
        }
        const refData = await refRes.json();
        const latestCommitSha = refData.object.sha;

        // Step 2: Upload each file as an isolated Git Blob
        publishBtn.textContent = `Uploading ${selectedFiles.length} assets...`;
        const treeItems = [];

        for (const file of selectedFiles) {
          let cleanPath = file.webkitRelativePath || file.name;
          // Strip outer parent directory when using folder selector so relative assets align
          if (cleanPath.includes('/')) {
            cleanPath = cleanPath.substring(cleanPath.indexOf('/') + 1);
          }

          const b64 = await fileToBase64(file);

          const blobRes = await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}/git/blobs`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ content: b64, encoding: 'base64' })
          });

          if (!blobRes.ok) {
            throw new Error(`Failed to upload asset: ${cleanPath}`);
          }
          const blobData = await blobRes.json();

          treeItems.push({
            path: `p/${slug}/${cleanPath}`,
            mode: '100644',
            type: 'blob',
            sha: blobData.sha
          });
        }

        // Step 3: Construct the Git Tree containing all assets
        publishBtn.textContent = 'Assembling file tree...';
        const treeRes = await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}/git/trees`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            base_tree: latestCommitSha,
            tree: treeItems
          })
        });

        if (!treeRes.ok) {
          throw new Error('Failed to generate git tree.');
        }
        const treeData = await treeRes.json();

        // Step 4: Create commit pointing to the new tree
        publishBtn.textContent = 'Creating commit...';
        const commitRes = await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}/git/commits`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            message: `Deploy full bundle for ${slug} via Hoster`,
            tree: treeData.sha,
            parents: [latestCommitSha]
          })
        });

        if (!commitRes.ok) {
          throw new Error('Failed to create commit.');
        }
        const commitData = await commitRes.json();

        // Step 5: Update the branch pointer to the new commit
        const patchRes = await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}/git/refs/heads/${BRANCH}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ sha: commitData.sha })
        });

        if (!patchRes.ok) {
          throw new Error('Failed to update branch reference.');
        }

        // Final URL pointing directly to hoster/p/<slug>/
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
  }

  // Copy URL button
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (!outputUrl.value) return;
      outputUrl.select();
      navigator.clipboard.writeText(outputUrl.value);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    });
  }

  // Open URL button
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (outputUrl.value) {
        window.open(outputUrl.value, '_blank');
      }
    });
  }
});
