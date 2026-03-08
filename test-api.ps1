# test-api-fixed.ps1
Write-Host "=================================" -ForegroundColor Cyan
Write-Host "TESTING CAREZONE API" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""

$baseUrl = "http://localhost:5000"

# 1. Test Public Endpoints
Write-Host "1. Testing Public Endpoints..." -ForegroundColor Yellow

try {
    $root = Invoke-RestMethod -Uri "$baseUrl/" -Method Get
    Write-Host "   ✅ Root endpoint: $($root.message)" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Root endpoint failed: $_" -ForegroundColor Red
}

try {
    $test = Invoke-RestMethod -Uri "$baseUrl/api/test" -Method Get
    Write-Host "   ✅ Test endpoint: $($test.message)" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Test endpoint failed: $_" -ForegroundColor Red
}

Write-Host ""

# 2. Test Login with all users
Write-Host "2. Testing Logins..." -ForegroundColor Yellow

$users = @(
    @{email = "michael@email.com"; name = "Michael Baya"; role = "caregiver"},
    @{email = "kimtai@email.com"; name = "Kimtai Adrean"; role = "caregiver"},
    @{email = "sarah@email.com"; name = "Sarah Chebet"; role = "caregiver"},
    @{email = "james.njoroge@email.com"; name = "James Njoroge"; role = "care_recipient"},
    @{email = "grace.achieng@email.com"; name = "Grace Achieng"; role = "care_recipient"},
    @{email = "samuel.kipchoge@email.com"; name = "Samuel Kipchoge"; role = "care_recipient"}
)

$token = $null

foreach ($user in $users) {
    Write-Host "`n   Testing: $($user.email)" -ForegroundColor Gray
    
    $loginBody = @{
        email = $user.email
        password = "password123"
    } | ConvertTo-Json
    
    try {
        $response = Invoke-RestMethod -Uri "$baseUrl/api/auth/login" -Method Post -Body $loginBody -ContentType "application/json"
        
        if ($response.success -eq $true) {
            Write-Host "   ✅ SUCCESS: $($response.user.name) ($($response.user.role))" -ForegroundColor Green
            Write-Host "      Token: $($response.token.Substring(0,20))..." -ForegroundColor Green
            
            # Store the first token for further tests
            if (-not $token) {
                $token = $response.token
            }
        } else {
            Write-Host "   ❌ Failed: $($response.message)" -ForegroundColor Red
        }
    } catch {
        Write-Host "   ❌ Error: $_" -ForegroundColor Red
        
        # Try to get more error details
        try {
            $errorResponse = $_.Exception.Response
            $reader = New-Object System.IO.StreamReader($errorResponse.GetResponseStream())
            $reader.BaseStream.Position = 0
            $responseBody = $reader.ReadToEnd()
            Write-Host "      Error details: $responseBody" -ForegroundColor Red
        } catch {
            # Ignore
        }
    }
}

# 3. Test Protected Endpoint (if we got a token)
if ($token) {
    Write-Host "`n3. Testing Protected Endpoint..." -ForegroundColor Yellow
    
    $headers = @{ "x-auth-token" = $token }
    
    try {
        $profile = Invoke-RestMethod -Uri "$baseUrl/api/users/profile" -Method Get -Headers $headers
        Write-Host "   ✅ Profile retrieved: $($profile.data.name)" -ForegroundColor Green
        Write-Host "      Role: $($profile.data.role)" -ForegroundColor Green
    } catch {
        Write-Host "   ❌ Profile failed: $_" -ForegroundColor Red
    }
}

# 4. Quick test with Michael (caregiver)
Write-Host "`n4. Quick Test - Michael's Visits..." -ForegroundColor Yellow

if ($token) {
    $headers = @{ "x-auth-token" = $token }
    
    try {
        $visits = Invoke-RestMethod -Uri "$baseUrl/api/visits/my-visits" -Method Get -Headers $headers
        Write-Host "   ✅ Found $($visits.count) visits for Michael" -ForegroundColor Green
    } catch {
        Write-Host "   ❌ Failed to get visits: $_" -ForegroundColor Red
    }
}

Write-Host "`n=================================" -ForegroundColor Cyan
Write-Host "Testing Complete!" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan